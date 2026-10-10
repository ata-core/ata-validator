'use strict';

// Compact modules: the verdict function and the schema, with error detail
// from one error runtime the modules of a build share. What they must keep:
// the verdict of the self-contained module on every document, and the error
// list the runtime Validator gives, in its order. Checked on the official
// suite in all five dialects, with code generation blocked for the runtime
// file, and through `ata build`'s choice between the two shapes.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { Validator } = require('..');
const aot = require('../lib/aot-impl');
const { build } = require('../lib/aot-build');
const { stripAnnotations } = require('../lib/schema-strip');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ata-compact-'));
const J = (x) => JSON.stringify(x);
const noCode = (x) => { const o = { ...x }; delete o.code; delete o.docUrl; if (o.branchErrors) o.branchErrors = o.branchErrors.map((b) => JSON.parse(noCode(b))); return J(o); };

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  'draft2019-09': 'https://json-schema.org/draft/2019-09/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  draft6: 'http://json-schema.org/draft-06/schema#',
  v1: 'https://json-schema.org/v1',
};

let n = 0;
function loadPair(dir, schema, opts) {
  // The compact module first, from a validator nothing has compiled yet: its
  // checks must not depend on what an earlier call left behind.
  const compact = aot.toCompactModule(new Validator(schema, opts), { format: 'cjs', errorRuntime: './ata-errors.cjs' });
  const full = aot.toStandaloneModule(new Validator(schema, opts), { format: 'cjs', onWarning() {} });
  if (!full || !compact) return null;
  const fa = path.join(dir, `full${n}.cjs`), fb = path.join(dir, `compact${n}.cjs`); n++;
  fs.writeFileSync(fa, full); fs.writeFileSync(fb, compact);
  return { full: require(fa), compact: require(fb) };
}

const tests = [
  ['suite, five dialects: verdicts match the module, errors match the runtime Validator', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'ata-errors.cjs'), aot.errorRuntimeSource('cjs'));
    let cases = 0, schemas = 0;
    const bad = [];
    for (const [dia, uri] of Object.entries(DIALECTS)) {
      const sdir = path.join(__dirname, 'suite/tests', dia);
      for (const f of fs.readdirSync(sdir).filter((x) => x.endsWith('.json'))) {
        for (const g of JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8'))) {
          const schema = g.schema && typeof g.schema === 'object' && !('$schema' in g.schema) ? { ...g.schema, $schema: uri } : g.schema;
          let pair, rt;
          try { pair = loadPair(dir, schema); rt = new Validator(schema, { useDefaults: false, richErrors: false }); } catch { continue; }
          if (!pair) continue;
          schemas++;
          for (const t of g.tests) {
            const a = pair.full.validate(t.data), b = pair.compact.validate(t.data);
            if (a.valid !== b.valid) { bad.push(`verdict ${dia}/${f}: ${g.description} / ${t.description}`); continue; }
            if (b.valid) continue;
            cases++;
            const want = rt.validate(structuredClone(t.data)).errors.map(noCode).join('\n');
            const got = b.errors.map(noCode).join('\n');
            if (want !== got) bad.push(`errors ${dia}/${f}: ${g.description} / ${t.description}\n  runtime ${want}\n  compact ${got}`);
          }
        }
      }
    }
    assert(schemas > 1300 && cases > 2000, `too little covered: ${schemas} schemas, ${cases} invalid cases`);
    assert(bad.length === 0, `${bad.length} differences, first:\n${bad.slice(0, 3).join('\n')}`);
  }],

  ['behind ata-validator/compiled, a compact module answers as new Validator(schema) does', () => {
    const b = require('../build');
    const { fromCompiled } = require('../compiled');
    const dir = tmpDir();
    const runtime = path.join(__dirname, '..', 'error-runtime.js');
    let modules = 0, cases = 0;
    const bad = [];
    for (const [dia, uri] of Object.entries({ 'draft2020-12': DIALECTS['draft2020-12'], draft7: DIALECTS.draft7 })) {
      const sdir = path.join(__dirname, 'suite/tests', dia);
      for (const f of fs.readdirSync(sdir).filter((x) => x.endsWith('.json'))) {
        for (const g of JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8'))) {
          const schema = g.schema && typeof g.schema === 'object' && !('$schema' in g.schema) ? { ...g.schema, $schema: uri } : g.schema;
          let src; try { src = b.compiledModuleFor(schema, { format: 'cjs', errorRuntime: runtime }); } catch { continue; }
          if (!src || !src.includes('createErrors')) continue;
          const file = path.join(dir, `w${n++}.cjs`);
          fs.writeFileSync(file, src);
          const w = fromCompiled(require(file), b.compiledSchemaFor(schema));
          const rt = new Validator(schema);
          modules++;
          for (const t of g.tests) {
            cases++;
            const a = J(w.validate(structuredClone(t.data))), c = J(rt.validate(structuredClone(t.data)));
            if (a !== c) bad.push(`${dia}/${f}: ${g.description} / ${t.description}\n  compiled ${a.slice(0, 300)}\n  runtime  ${c.slice(0, 300)}`);
          }
        }
      }
    }
    assert(modules > 500 && cases > 1800, `too little covered: ${modules} modules, ${cases} cases`);
    assert(bad.length === 0, `${bad.length} differences, first:\n${bad.slice(0, 3).join('\n')}`);
  }],

  ['codes and docUrl are stamped like a module stamps them', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'ata-errors.cjs'), aot.errorRuntimeSource('cjs'));
    const p = loadPair(dir, { type: 'object', properties: { a: { type: 'string', format: 'email' }, b: { oneOf: [{ type: 'integer' }, { type: 'null' }] } }, required: ['c'], dependentRequired: { a: ['d'] } });
    const e = p.compact.validate({ a: 'x', b: 'y' }).errors;
    const by = Object.fromEntries(e.map((x) => [x.schemaPath, x]));
    assert(by['#/properties/a/format'].code === 'ATA3001', 'format code');
    assert(by['#/properties/a/format'].docUrl === 'https://ata-validator.com/e/ATA3001', 'docUrl');
    assert(by['#/required'].code === 'ATA7001', 'required code');
    assert(by['#/dependentRequired'].code === 'ATA7005', 'dependentRequired code');
    const one = by['#/properties/b/oneOf'];
    assert(one.code === 'ATA4001' && one.docUrl === undefined, 'collapsed branch error keeps the module shape');
    assert(one.branchErrors[0].code === 'ATA1001', 'branch errors stamped');
  }],

  ['the error runtime runs with code generation blocked', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'ata-errors.mjs'), aot.errorRuntimeSource('esm'));
    const v = new Validator({ type: 'object', properties: { s: { type: 'string', pattern: '^[a-z]+$' } }, additionalProperties: false });
    fs.writeFileSync(path.join(dir, 'm.mjs'), aot.toCompactModule(v, { format: 'esm', errorRuntime: './ata-errors.mjs' }));
    const r = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e',
      `const m = await import(${J(path.join(dir, 'm.mjs'))}); const r = m.validate({ s: 'A1', z: 1 }); console.log(JSON.stringify([m.isValid({ s: 'ab' }), r.valid, r.errors.map((e) => e.keyword)]))`], { encoding: 'utf8' });
    assert(r.status === 0, r.stderr);
    assert(r.stdout.trim() === '[true,false,["pattern","additionalProperties"]]', r.stdout);
  }],

  ['validators the runtime cannot follow keep the self-contained module', () => {
    const s = { type: 'string', format: 'email' };
    const decline = (o) => aot.compactDecline(new Validator(s, o));
    assert(decline() === null, 'plain validator is eligible');
    assert(decline({ assertFormat: false }) !== null, 'assertFormat: false');
    assert(decline({ coerceTypes: true }) !== null, 'coerceTypes');
    assert(decline({ removeAdditional: true }) !== null, 'removeAdditional');
    assert(decline({ formats: { email: () => true } }) !== null, 'custom formats');
    assert(decline({ baseURI: 'https://x.test/' }) !== null, 'baseURI');
    const withMap = new Validator({ $ref: 'https://x.test/a' }, { schemas: { 'https://x.test/a': { type: 'string' } } });
    assert(aot.compactDecline(withMap) !== null, 'registered schemas');
    assert(aot.toCompactModule(new Validator(s, { assertFormat: false }), { errorRuntime: './e.mjs' }) === null, 'toCompactModule returns null');
  }],

  ['a reference outside the schema keeps the self-contained module', () => {
    const b = require('../build');
    for (const s of [
      { $ref: 'https://json-schema.org/draft/2020-12/schema' },
      { properties: { a: { $ref: '#/$defs/missing' } } },
    ]) {
      assert(aot.compactDecline(new Validator(s)) !== null, 'declined: ' + J(s));
      const src = b.compiledModuleFor(s, { format: 'cjs', errorRuntime: 'ata-validator/error-runtime' });
      assert(src === null || !src.includes('error-runtime'), 'compiledModuleFor wrote a compact module for ' + J(s));
    }
    const local = { $id: 'https://x.test/r', $defs: { a: { $id: 'a.json', type: 'string' } }, $ref: 'a.json' };
    assert(aot.compactDecline(new Validator(local)) === null, 'a reference to an embedded resource stays eligible');
  }],

  ['a "__proto__" property name stays a property', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'ata-errors.cjs'), aot.errorRuntimeSource('cjs'));
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}');
    const v = new Validator(schema);
    if (aot.toStandaloneModule(v, { format: 'cjs', onWarning() {} }) === null) {
      // The code generator declines this schema; the compact module, which
      // carries the same verdict function, has to decline it with it.
      assert(aot.toCompactModule(v, { format: 'cjs', errorRuntime: './ata-errors.cjs' }) === null, 'compact declines with the module');
      return;
    }
    const p = loadPair(dir, schema);
    const doc = JSON.parse('{"__proto__": 1}');
    const r = p.compact.validate(doc);
    assert(!r.valid && r.errors.length === 1 && r.errors[0].instancePath === '/__proto__' && r.errors[0].keyword === 'type', J(r.errors));
    assert(J(p.full.validate(doc).errors.map(noCode)) === J(r.errors.map(noCode)), 'same as the module');
  }],

  ['annotations go only from schema positions', () => {
    const s = {
      title: 'T', description: 'd', 'x-tool': 1, examples: [{}],
      properties: {
        description: { type: 'string', description: 'kept key, dropped annotation' },
        k: { enum: [{ description: 'data' }], default: 1 },
        c: { const: { title: 'data' } },
        u: { oneOf: [{ title: 'First', type: 'string' }, { title: 'Second', type: 'number', description: 'x' }] },
      },
      $defs: { title: { type: 'integer', $comment: 'c' } },
    };
    const out = stripAnnotations(s);
    assert(J(out) === J({
      properties: {
        description: { type: 'string' },
        k: { enum: [{ description: 'data' }] },
        c: { const: { title: 'data' } },
        u: { oneOf: [{ title: 'First', type: 'string' }, { title: 'Second', type: 'number' }] },
      },
      $defs: { title: { type: 'integer' } },
    }), J(out));
    const into = { properties: { a: { $ref: '#/properties/b/default' } , b: { default: { type: 'string' } } } };
    assert(stripAnnotations(into) === into, 'a $ref through a dropped keyword leaves the schema as it is');
  }],

  ['ata build: several large schemas share the runtime, and it is smaller', async () => {
    const dir = tmpDir();
    const big = (seed) => {
      const props = {};
      for (let i = 0; i < 120; i++) {
        props['field' + seed + '_' + i] = {
          description: `The ${i}th field of schema ${seed}, described the way published schemas describe things, at some length.`,
          type: i % 3 === 0 ? 'string' : i % 3 === 1 ? 'integer' : 'object',
          ...(i % 3 === 0 ? { maxLength: 40 + i, pattern: '^[a-z]+$' } : {}),
          ...(i % 3 === 1 ? { minimum: i, maximum: 1000 + i } : {}),
          ...(i % 3 === 2 ? { properties: { x: { type: 'number' }, y: { type: 'string', enum: ['a', 'b', 'c'] } }, required: ['x'], additionalProperties: false } : {}),
        };
      }
      return { type: 'object', properties: props, required: Object.keys(props).slice(0, 10), additionalProperties: false };
    };
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, `s${i}.schema.json`), J(big(i)));
    const inline = await build({ globs: [path.join(dir, '*.schema.json')], outDir: path.join(dir, 'inline'), source: false, types: false, errors: 'inline' });
    const auto = await build({ globs: [path.join(dir, '*.schema.json')], outDir: path.join(dir, 'auto'), source: false, types: false });
    assert(inline.runtime === null && inline.compiled.every((c) => c.errors === 'inline'), 'inline mode writes no runtime');
    assert(auto.runtime !== null && auto.compiled.every((c) => c.errors === 'compact'), 'auto chose the shared runtime');
    const total = (r) => r.compiled.reduce((a, c) => a + c.gzipBytes, 0) + (r.runtime ? r.runtime.gzipBytes : 0);
    assert(total(auto) < total(inline), `auto ${total(auto)} should be below inline ${total(inline)}`);
    const src = fs.readFileSync(path.join(dir, 'auto', 's0.compiled.mjs'), 'utf8');
    assert(src.includes('from "./ata-errors.mjs"'), 'imports the runtime beside it');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m = await import(${J(path.join(dir, 'auto', 's1.compiled.mjs'))}); const i = await import(${J(path.join(dir, 'inline', 's1.compiled.mjs'))}); const d = { field1_0: 'AB', field1_1: 0.5, extra: 1 }; console.log(m.validate(d).valid === i.validate(d).valid && m.validate(d).errors.length > 0)`], { encoding: 'utf8' });
    assert(r.stdout.trim() === 'true', r.stderr || r.stdout);
  }],

  ['ata build: one small schema keeps the self-contained module', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'u.schema.json'), J({ type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }));
    const r = await build({ globs: [path.join(dir, '*.schema.json')], source: false, types: false });
    assert(r.runtime === null, 'no runtime for one small schema');
    assert(r.compiled[0].errors === 'inline', 'inline module');
    assert(!fs.existsSync(path.join(dir, 'ata-errors.mjs')), 'no runtime file written');
  }],

  ['ata build: development builds (schema source frames) keep the self-contained module', async () => {
    const dir = tmpDir();
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(dir, `s${i}.schema.json`), J({ type: 'object', properties: { a: { type: 'string' } } }));
    const r = await build({ globs: [path.join(dir, '*.schema.json')], source: true, types: false, errors: 'shared' });
    assert(r.runtime === null && r.compiled.every((c) => c.errors === 'inline'), 'source frames win');
  }],

  ['ata build: the cache follows the choice', async () => {
    const dir = tmpDir();
    const cacheFile = path.join(dir, '.cache.json');
    for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(dir, `s${i}.schema.json`), J({ type: 'object', properties: { a: { type: 'string', description: 'x'.repeat(50) } } }));
    const opts = { globs: [path.join(dir, '*.schema.json')], source: false, types: false, cacheFile, outDir: path.join(dir, 'out') };
    const first = await build({ ...opts, errors: 'shared' });
    assert(first.compiled.length === 2 && first.runtime !== null, 'shared first');
    const second = await build({ ...opts, errors: 'shared' });
    assert(second.cached.length === 2 && second.compiled.length === 0, 'cached second');
    const third = await build({ ...opts, errors: 'inline' });
    assert(third.compiled.length === 2 && third.compiled.every((c) => c.errors === 'inline'), 'mode change rebuilds');
    assert(!fs.readFileSync(path.join(dir, 'out', 's0.compiled.mjs'), 'utf8').includes('ata-errors'), 'inline module no longer imports the runtime');
  }],
];

(async () => {
  console.log('\ncompact modules\n');
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message.split('\n').join('\n       ')); }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
})();
