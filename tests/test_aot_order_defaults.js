'use strict';

// A standalone module (toStandaloneModule, ata compile, ata build) can answer
// as the runtime Validator does in the two places it used not to:
//
// - applyDefaults(data), exported when the schema declares a default, fills
//   them in with the runtime's own pass (preprocessSource in
//   lib/codegen-engine.js). validate() does not call it, so a module without
//   the call answers as before and fromCompiled keeps `useDefaults: false`.
// - With `order: true`, validate() hands its errors out in the runtime's order
//   (lib/aot-order.js), without their ordinals. Without it the module is the
//   one it always was.
//
// Every group of the official 2020-12 and draft-07 suites the module compiles
// is checked against the runtime: verdict, the data after defaults, and every
// error's keyword, instancePath, schemaPath, message and params, in order.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build.js');
const { toTypeScript } = require('../lib/ts-gen');

const load = (src, name) => { const m = new Module(name); m._compile(src, path.join(__dirname, name)); return m.exports; };
let n = 0;
const compile = (schema, opts) => {
  let degraded = false;
  const src = toStandaloneModule(schema, { format: 'cjs', ...opts, onWarning: (w, i) => { if (i && i.kind === 'error-detail') degraded = true; } });
  return src && !degraded ? { src, mod: load(src, `.order-defaults-${n++}.cjs`) } : null;
};
const shape = (errors) => JSON.stringify(errors.map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message, e.params]));

// applyDefaults: present only with a default, the runtime's answer, not run by validate().
{
  const schema = { type: 'object', properties: { a: { type: 'string', default: 'hi' }, b: { type: 'object', properties: { c: { type: 'integer', default: 3 } } } }, required: ['a'] };
  const { src, mod } = compile(schema);
  assert.strictEqual(typeof mod.applyDefaults, 'function', 'a schema with a default exports applyDefaults');
  const data = { b: {} };
  assert.strictEqual(mod.validate(structuredClone(data)).valid, false, 'validate() does not fill defaults by itself');
  const filled = structuredClone(data);
  mod.applyDefaults(filled);
  const runtime = structuredClone(data);
  const r = new Validator(schema).validate(runtime);
  assert.deepStrictEqual(filled, runtime, 'applyDefaults fills what the runtime fills');
  assert.strictEqual(mod.validate(filled).valid, r.valid);
  assert.match(toTypeScript(schema, { name: 'S', applyDefaults: /\nfunction applyDefaults\(/.test(src) }), /export declare function applyDefaults\(data: unknown\): void;/);
  const plain = compile({ type: 'object', properties: { a: { type: 'string' } } });
  assert.strictEqual(plain.mod.applyDefaults, undefined, 'a schema without a default exports no applyDefaults');
  assert.doesNotMatch(toTypeScript({ type: 'object' }, { name: 'S' }), /applyDefaults/);
}

// order: behind a shared definition, the runtime's order; without it, no sort in the module.
{
  const schema = { type: 'object', $defs: { addr: { type: 'object', properties: { zip: { type: 'string', pattern: '^[0-9]{5}$' }, city: { type: 'string', minLength: 2 } }, required: ['city'] } }, properties: { home: { $ref: '#/$defs/addr' }, work: { $ref: '#/$defs/addr' }, name: { type: 'string', minLength: 2 } } };
  const data = { work: { zip: 'x', city: 'a' }, home: { zip: '1' }, name: 'a' };
  const want = new Validator(schema).validate(structuredClone(data)).errors;
  const ordered = compile(schema, { order: true }).mod.validate(structuredClone(data)).errors;
  assert.strictEqual(shape(ordered), shape(want), 'order: true gives the runtime order behind a reference');
  for (const e of ordered) assert.ok(!('_o' in e), 'no ordinal in what the caller gets');
  const plain = compile(schema);
  assert.doesNotMatch(plain.src, /_ataOrder|_o:/, 'without order the module carries no sort and no ordinals');
}
{
  // Without a reference: the collector reports additionalProperties before properties.
  const schema = { type: 'object', properties: { a: { type: 'string', format: 'email', pattern: '^x' } }, additionalProperties: false };
  const data = { a: 'nope', b: 1 };
  const want = new Validator(schema).validate(structuredClone(data)).errors;
  const { src, mod } = compile(schema, { order: true });
  assert.match(src, /_o:/, 'without a reference the module sorts by the ordinals written in');
  assert.doesNotMatch(src, /_ataSkeleton = JSON/, 'and carries no skeleton');
  assert.strictEqual(shape(mod.validate(structuredClone(data)).errors), shape(want));
}

// Asked for where it cannot be given: told.
{
  const warnings = [];
  toStandaloneModule({ type: 'object', properties: { a: { type: 'string' } } }, { order: true, abortEarly: true, onWarning: (w, i) => warnings.push(i && i.kind) });
  assert.ok(warnings.includes('order'), 'order with stub errors warns');
}

// The suites: verdict, data after defaults, errors in order.
let groups = 0, cases = 0;
const suite = path.join(__dirname, 'suite', 'tests');
for (const dialect of ['draft2020-12', 'draft7']) {
  const dir = path.join(suite, dialect);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      let c; try { c = compile(g.schema, { order: true }); } catch { c = null; }
      if (!c) continue;
      groups++;
      const v = new Validator(g.schema);
      for (const t of g.tests) {
        const d1 = structuredClone(t.data), d2 = structuredClone(t.data);
        const a = v.validate(d1);
        if (c.mod.applyDefaults) c.mod.applyDefaults(d2);
        const b = c.mod.validate(d2);
        cases++;
        const where = `${dialect}/${f}: ${g.description}: ${t.description}`;
        assert.strictEqual(b.valid, a.valid, where);
        assert.deepStrictEqual(d2, d1, `${where}: data after defaults`);
        if (!a.valid) assert.strictEqual(shape(b.errors), shape(a.errors), `${where}: errors`);
      }
    }
  }
}
assert.ok(groups > 500, `only ${groups} suite groups compiled`);

console.log(`ok: applyDefaults is the runtime's pass, order: true is the runtime's order; ${groups} suite groups, ${cases} cases agree`);
