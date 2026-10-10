'use strict';

// The edge entry (index.edge.js): what `ata-validator` resolves to in
// Cloudflare Workers (the `workerd` export condition) and Vercel Edge
// (`edge-light`), where generated code cannot run. It must export what the
// full package exports, answer as the full package answers in such a
// runtime, and leave the code generator out of a bundle.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

// The same names as the full package.
{
  const out = spawnSync(process.execPath, ['-e', `
    const full = Object.keys(require(${JSON.stringify(root)})).sort();
    console.log(JSON.stringify(full));
  `], { encoding: 'utf8' });
  const edge = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(Object.keys(require(${JSON.stringify(path.join(root, 'index.edge.js'))})).sort()))`], { encoding: 'utf8' });
  assert.strictEqual(edge.stdout.trim(), out.stdout.trim(), 'the edge entry exports what the full package exports');
  const esm = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const a = Object.keys(await import(${JSON.stringify(path.join(root, 'index.mjs'))})).sort(), b = Object.keys(await import(${JSON.stringify(path.join(root, 'index.edge.mjs'))})).sort();
    console.log(JSON.stringify(a) === JSON.stringify(b));
  `], { encoding: 'utf8' });
  assert.strictEqual(esm.stdout.trim(), 'true', esm.stderr);
  console.log('ok: the edge entry exports the full package\'s names, in CommonJS and ESM');
}

// With code generation blocked, as in those runtimes, the edge entry answers
// the official suite as the full package does: verdicts and errors, through
// validate, isValidObject and validateJSON.
{
  const script = (entry) => `
    const fs = require('fs'), path = require('path');
    const { Validator } = require(${JSON.stringify(root)} + '/' + ${JSON.stringify(entry)});
    const out = [];
    for (const [dia, uri] of [['draft2020-12', 'https://json-schema.org/draft/2020-12/schema'], ['draft7', 'http://json-schema.org/draft-07/schema#']]) {
      const dir = path.join(${JSON.stringify(path.join(root, 'tests/suite/tests'))}, dia);
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        const schema = g.schema && typeof g.schema === 'object' && !('$schema' in g.schema) ? { ...g.schema, $schema: uri } : g.schema;
        let v; try { v = new Validator(schema); } catch (e) { out.push('ctor ' + e.message); continue; }
        for (const t of g.tests) {
          const r = v.validate(JSON.parse(JSON.stringify(t.data)));
          out.push(JSON.stringify([r.valid, r.valid ? [] : r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath, e.message]), v.isValidObject(JSON.parse(JSON.stringify(t.data))), v.validateJSON(JSON.stringify(t.data)).valid]));
        }
      }
    }
    console.log(out.length + '\\n' + require('crypto').createHash('sha256').update(out.join('\\n')).digest('hex'));
  `;
  const env = { ...process.env, ATA_NO_NATIVE: '1' };
  const full = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '-e', script('index.js')], { encoding: 'utf8', env, maxBuffer: 1 << 26 });
  const edge = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '-e', script('index.edge.js')], { encoding: 'utf8', env, maxBuffer: 1 << 26 });
  assert.strictEqual(full.status, 0, full.stderr);
  assert.strictEqual(edge.status, 0, edge.stderr);
  const [n] = full.stdout.trim().split('\n');
  assert.ok(+n > 2000, `too few cases: ${n}`);
  assert.strictEqual(edge.stdout.trim(), full.stdout.trim(), 'the edge entry answers as the full package does with code generation blocked');
  console.log(`ok: with code generation blocked the edge entry answers ${n} suite cases as the full package does`);
}

// Modules from `ata build` load through it, and the emitters say where they are.
{
  const out = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '-e', `
    const { Validator } = require(${JSON.stringify(path.join(root, 'index.edge.js'))});
    const s = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] };
    const mod = { boolFn: (d) => d !== null && typeof d === 'object' && Number.isInteger(d.n), errFn: (d) => ({ valid: false, errors: [{ keyword: 'required', instancePath: '', message: 'm' }] }) };
    const v = Validator.fromStandalone(mod, s);
    let emit; try { Validator.bundle([s]); emit = 'ran'; } catch (e) { emit = e.message.includes('ata-validator/aot') ? 'points to aot' : e.message; }
    console.log(JSON.stringify([v.validate({ n: 1 }).valid, v.validate({}).valid, emit]));
  `], { encoding: 'utf8' });
  assert.strictEqual(out.stdout.trim(), '[true,false,"points to aot"]', out.stderr || out.stdout);
  console.log('ok: modules from ata build load through the edge entry; the emitters point to ata-validator/aot');
}

// Bundled for Workers, `ata-validator` is the edge entry and carries no code
// generator; for a browser it is still the full package.
{
  let esbuild;
  try { esbuild = require('esbuild'); } catch { console.log('skip: esbuild is not installed'); return; }
  const entry = path.join(root, 'tests', '.edge-entry-probe.mjs');
  fs.writeFileSync(entry, "import { Validator } from 'ata-validator'\nglobalThis.V = Validator\n");
  try {
    const build = (conditions, platform) => esbuild.buildSync({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', platform, conditions, mainFields: ['browser', 'module', 'main'], write: false, metafile: true, logLevel: 'silent'});
    const worker = build(['workerd', 'worker', 'browser'], 'neutral');
    const inputs = Object.keys(worker.metafile.inputs);
    assert.ok(inputs.some((k) => k.endsWith('index.edge.js')), 'the workerd condition selects the edge entry');
    assert.ok(!inputs.some((k) => /js-compiler|codegen-engine/.test(k)), 'no code generator in a Workers bundle');
    const size = require('zlib').gzipSync(worker.outputFiles[0].contents, { level: 9 }).length;
    // 60.5 KB measured when the entry was added.
    assert.ok(size < 64 * 1024, `the Workers bundle is ${size} bytes gzipped, over 64 KB`);
    const browser = build(['browser'], 'browser');
    assert.ok(Object.keys(browser.metafile.inputs).some((k) => /codegen-engine/.test(k)), 'a browser bundle keeps the code generator');
    console.log(`ok: a Workers bundle resolves to the edge entry, ${size} bytes gzipped, no code generator`);
  } finally {
    fs.rmSync(entry, { force: true });
  }
}
