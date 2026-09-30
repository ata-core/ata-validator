'use strict';

// A standalone module built with --source names each error's schema-source
// frame. The frame used to be written inline at every error site, carrying the
// whole source line, and a schema kept on one line is one line of all of it: a
// 2 KB schema built to 214 KB of module. Frames are now written once at module
// scope with each line's text stored once. This checks the text appears once,
// the frames still point at the keyword that failed, they stay frozen, and the
// module no longer grows with (error sites x schema length).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert');

const img = { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string', minLength: 1, maxLength: 100 }, type: { type: 'string', enum: ['jpg', 'png'] }, url: { type: 'string', format: 'uri' } }, required: ['id', 'title', 'type', 'url'] };
const schema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100 },
    price: { type: 'number', minimum: 1, maximum: 10000 },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 30 } },
    images: { type: 'array', items: img },
    ratings: { type: 'array', items: { type: 'object', properties: { stars: { type: 'number', minimum: 0, maximum: 5 }, images: { type: 'array', items: img } }, required: ['stars', 'images'] } },
  },
  required: ['title', 'price', 'tags', 'images', 'ratings'],
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-aot-frames-'));
const cli = path.join(__dirname, '..', 'bin', 'ata.js');

function build (name, text, flag) {
  const sub = path.join(dir, name);
  fs.mkdirSync(sub);
  const file = path.join(sub, 'product.schema.json');
  fs.writeFileSync(file, text);
  execFileSync(process.execPath, [cli, 'build', flag, file], { stdio: 'pipe' });
  return path.join(sub, 'product.compiled.mjs');
}

(async () => {
  try {
    const oneLine = JSON.stringify(schema);
    const withSource = build('src', oneLine, '--source');
    const noSource = build('nosrc', oneLine, '--no-source');
    const code = fs.readFileSync(withSource, 'utf8');

    // The source line is stored once, however many error sites refer to it.
    const needle = JSON.stringify(oneLine).slice(1, 80);
    const occurrences = code.split(needle).length - 1;
    assert.strictEqual(occurrences, 1, `the schema's source line should appear once, found ${occurrences}`);

    // What source costs is the table, not a copy per site.
    const extra = code.length - fs.readFileSync(noSource, 'utf8').length;
    assert.ok(extra < oneLine.length * 4 + 20000, `--source added ${extra} bytes for a ${oneLine.length}-byte schema`);

    const mod = await import('file://' + withSource);
    const r = mod.validate({ title: '', price: 0, tags: [''], images: [{ id: 1, title: 'x', type: 'gif', url: 'u' }], ratings: [] });
    assert.strictEqual(r.valid, false);
    let framed = 0;
    for (const e of r.errors) {
      const s = e.schemaSource;
      if (!s) continue;
      framed++;
      assert.ok(Object.isFrozen(s), 'frames stay frozen');
      assert.strictEqual(s.line, 1);
      assert.strictEqual(s.text, oneLine, 'the frame carries its source line');
      assert.ok(s.file.endsWith('product.schema.json'));
      const at = s.text.slice(s.col - 1);
      assert.ok(at.startsWith('"' + e.keyword + '"'), `frame for ${e.schemaPath} points at ${at.slice(0, 20)}`);
    }
    assert.ok(framed >= 4, `expected frames on the errors, got ${framed}`);
    console.log(`ok: aot source frames (${r.errors.length} errors, ${framed} framed, module ${code.length} bytes)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
