'use strict';

// A compact module takes the RFC 3986 walk from the error runtime it already
// imports (`uriWalk`), where a self-contained module carries the factory's
// text: forty SchemaStore schemas built as compact modules carried forty
// copies, about 1.3 KB gzipped each. The module must answer as the runtime
// Validator does, from the generated runtime and from
// ata-validator/error-runtime, in both module formats.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Validator } = require('..');
const aot = require('../lib/aot.js');

const schema = { type: 'object', properties: { home: { type: 'string', format: 'uri' }, ref: { type: 'string', format: 'uri-reference' }, site: { type: 'string', format: 'iri' } } };
const docs = [
  { home: 'http://localhost:5000', ref: 'a/b' }, { home: 'http://[::ffff:01.2.3.4]', ref: 'x' }, { home: 'https://x.y/', ref: '1:b' },
  { home: 'https://u@p@h/', ref: '' }, { home: 'http://[::1]:80/p?q#f', ref: '//h:80/p' }, { home: 'http://a#b#c', ref: 'ok' },
  { site: 'http://例え.jp/パス' }, { home: 'http://例え.jp/' }, { ref: '/[::1]' }, { ref: '%41', home: 'urn:isbn:1' },
];
const v = new Validator(schema);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-cuw-'));

const compact = aot.toCompactModule(v, { errorRuntime: './ata-errors.cjs', format: 'cjs' });
assert.ok(compact, 'the compact module compiles');
assert.ok(!/__ataUri/.test(compact), 'a compact module carries no walk of its own');
assert.ok(/uriWalk: _ataUriWalk/.test(compact), 'a compact module imports the walk');
const standalone = aot.toStandaloneModule(v, { format: 'cjs' });
assert.ok(/__ataUri/.test(standalone), 'a self-contained module keeps the walk');
assert.ok(zlib.gzipSync(compact).length < zlib.gzipSync(standalone).length - 800, 'the compact module is the smaller by the walk');

fs.writeFileSync(path.join(dir, 'ata-errors.cjs'), aot.errorRuntimeSource('cjs', [v]));
fs.writeFileSync(path.join(dir, 'gen.cjs'), compact);
fs.writeFileSync(path.join(dir, 'pkg.cjs'), aot.toCompactModule(v, { errorRuntime: require.resolve('../error-runtime.js'), format: 'cjs' }));
let n = 0;
for (const file of ['gen.cjs', 'pkg.cjs']) {
  const m = require(path.join(dir, file));
  for (const d of docs) {
    const want = v.validate(d);
    assert.strictEqual(m.isValid(d), want.valid, `${file} isValid ${JSON.stringify(d)}`);
    const got = m.validate(d);
    assert.strictEqual(got.valid, want.valid, `${file} validate ${JSON.stringify(d)}`);
    if (!want.valid) assert.deepStrictEqual(got.errors.map((e) => e.keyword + e.instancePath), want.errors.map((e) => e.keyword + e.instancePath), `${file} errors ${JSON.stringify(d)}`);
    n++;
  }
}
const rt = require('../error-runtime.js');
assert.strictEqual(rt.uriWalk('http://[::1]:80/', 1), true);
assert.strictEqual(rt.uriWalk('1:b', 0), false);
console.log(`ok: compact modules share the URI walk through the error runtime (${n} documents, two runtimes)`);
