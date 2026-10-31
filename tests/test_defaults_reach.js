'use strict';

// Where `default` values are filled: in every schema applied to a value, as
// ajv's useDefaults fills them, through `$ref` (recursive too), `allOf`,
// `items`, `prefixItems`, `additionalProperties`, `patternProperties` and
// `dependentSchemas`, and not in `anyOf`, `oneOf` or `if`/`then`. The pass
// used to stop at `properties`. Three places fill defaults and all three must
// agree: the generated pass (the default validator), the closure pass (the
// interpreted engine, and the default validator where the generated pass
// declines a schema), and the applyDefaults a compiled module exports.

const assert = require('assert');
const Module = require('module');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build.js');

let n = 0;
const moduleFill = (schema) => {
  const src = toStandaloneModule(schema, { format: 'cjs' });
  const m = new Module('defaults-' + n);
  m._compile(src, __dirname + `/.defaults-reach-${n++}.cjs`);
  return m.exports.applyDefaults || null;
};
const fills = (schema) => ({
  generated: (d) => { new Validator(schema).validate(d); return d; },
  closure: (d) => { new Validator(schema, { engine: 'interpreter' }).validate(d); return d; },
  module: (d) => { const f = moduleFill(schema); if (f) f(d); return d; },
});

// What ajv 8 with useDefaults fills, row by row (measured, written here).
const D = { type: 'object', properties: { c: { type: 'string', default: 'X' } } };
const MATRIX = [
  ['properties', { type: 'object', properties: { o: D } }, { o: {} }, { o: { c: 'X' } }],
  ['$ref', { type: 'object', $defs: { d: D }, properties: { o: { $ref: '#/$defs/d' } } }, { o: {} }, { o: { c: 'X' } }],
  ['root $ref', { $defs: { d: D }, $ref: '#/$defs/d' }, {}, { c: 'X' }],
  ['items', { type: 'object', properties: { a: { type: 'array', items: D } } }, { a: [{}, {}] }, { a: [{ c: 'X' }, { c: 'X' }] }],
  ['prefixItems', { type: 'object', properties: { a: { type: 'array', prefixItems: [D] } } }, { a: [{}] }, { a: [{ c: 'X' }] }],
  ['allOf', { type: 'object', allOf: [D] }, {}, { c: 'X' }],
  ['anyOf', { type: 'object', anyOf: [D] }, {}, {}],
  ['oneOf', { type: 'object', oneOf: [D] }, {}, {}],
  ['additionalProperties', { type: 'object', additionalProperties: D }, { x: {} }, { x: { c: 'X' } }],
  ['patternProperties', { type: 'object', patternProperties: { '^x': D } }, { x: {} }, { x: { c: 'X' } }],
  ['dependentSchemas', { type: 'object', dependentSchemas: { k: D } }, { k: 1 }, { k: 1, c: 'X' }],
  ['recursive $ref', { $defs: { n: { type: 'object', properties: { c: { type: 'string', default: 'X' }, kid: { $ref: '#/$defs/n' } } } }, $ref: '#/$defs/n' }, { kid: { kid: {} } }, { kid: { kid: { c: 'X' }, c: 'X' }, c: 'X' }],
  ['default on a missing parent', { type: 'object', properties: { o: { type: 'object', default: {}, properties: { c: { type: 'string', default: 'X' } } } } }, {}, { o: { c: 'X' } }],
];
for (const [name, schema, data, want] of MATRIX) {
  for (const [path, fill] of Object.entries(fills(schema))) {
    assert.deepStrictEqual(fill(structuredClone(data)), want, `${name}, ${path}`);
  }
}

// Seeded schemas mixing every place a default is reached, and documents for
// them: the three fill the same.
let x = 0x5eed7;
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k; };
const pick = (a) => a[rnd(a.length)];
const leaf = () => (rnd(2) ? { type: 'string', default: pick(['a', 'b']) } : { type: 'integer', default: pick([1, 2]) });
function node(depth, defs) {
  const s = { type: 'object', properties: {} };
  for (const k of ['p', 'q']) if (rnd(3)) s.properties[k] = depth > 0 && rnd(2) ? node(depth - 1, defs) : leaf();
  if (depth > 0) {
    const r = rnd(9);
    if (r === 0) s.properties.list = { type: 'array', items: node(depth - 1, defs) };
    else if (r === 1) s.properties.tup = { type: 'array', prefixItems: [node(depth - 1, defs)], items: node(depth - 1, defs) };
    else if (r === 2) s.additionalProperties = node(depth - 1, defs);
    else if (r === 3) s.patternProperties = { '^z': node(depth - 1, defs) };
    else if (r === 4) s.allOf = [node(depth - 1, defs)];
    else if (r === 5) s.dependentSchemas = { p: node(depth - 1, defs) };
    else if (r === 6 && defs.length) s.properties.ref = { $ref: '#/$defs/' + pick(defs) };
  }
  return s;
}
function doc(depth) {
  const o = {};
  for (const k of ['p', 'q', 'list', 'tup', 'ref', 'z1', 'w']) {
    if (rnd(2)) continue;
    o[k] = depth > 0 && rnd(2) ? (k === 'list' || k === 'tup' ? [doc(depth - 1), doc(depth - 1)] : doc(depth - 1)) : pick([1, 'v', {}, [], null]);
  }
  return o;
}
let schemas = 0, docs = 0;
for (let i = 0; i < 300; i++) {
  const schema = node(3, ['d0', 'd1']);
  schema.$defs = { d0: node(1, []), d1: { type: 'object', properties: { a: leaf(), self: { $ref: '#/$defs/d1' } } } };
  const f = fills(schema);
  schemas++;
  for (let j = 0; j < 4; j++) {
    const d = doc(3);
    const g = f.generated(structuredClone(d)), c = f.closure(structuredClone(d)), m = f.module(structuredClone(d));
    docs++;
    assert.deepStrictEqual(c, g, `schema ${i} doc ${j}: closure and generated passes`);
    assert.deepStrictEqual(m, g, `schema ${i} doc ${j}: module applyDefaults and the validator`);
  }
}

// Data that contains itself, under a recursive schema: the pass stops.
{
  const schema = { $defs: { n: { type: 'object', properties: { c: { type: 'string', default: 'X' }, kid: { $ref: '#/$defs/n' } } } }, $ref: '#/$defs/n' };
  const d = {};
  d.kid = d;
  new Validator(schema, { engine: 'interpreter' }).validate(d);
  assert.strictEqual(d.c, 'X');
}

// A schema that refers back to the root, with an object default, as
// Renovate's does: inside the value made from the default the root is not
// applied again, so the pass ends (ajv throws a RangeError here).
{
  const schema = { type: 'object', properties: { c: { type: 'string', default: 'X' }, o: { allOf: [{ $ref: '#' }], default: {} } } };
  for (const [path, fill] of Object.entries(fills(schema))) {
    assert.deepStrictEqual(fill({}), { c: 'X', o: {} }, `back to the root, ${path}`);
    assert.deepStrictEqual(fill({ o: {} }), { c: 'X', o: { c: 'X', o: {} } }, `back to the root, given data, ${path}`);
  }
}

// A default under a property named __proto__, reached through items: an own
// key, and Object.prototype untouched.
{
  const schema = { type: 'array', items: { type: 'object', properties: { ['__proto__']: { type: 'object', default: { polluted: true } } } } };
  for (const fill of Object.values(fills(schema))) {
    const d = fill([{}]);
    assert.ok(Object.hasOwn(d[0], '__proto__'));
    assert.strictEqual(({}).polluted, undefined);
  }
}

// A fragment $ref under an embedded $id resolves against that resource, as
// validation resolves it. The passes used to read it against the outer root
// and filled the outer definition's default into a value the inner one
// governs. Declining to fill is acceptable; filling the wrong default is not.
{
  const embedded = {
    type: 'object',
    $defs: { x: { type: 'object', properties: { a: { type: 'string', default: 'outer' } } } },
    properties: { inner: { $id: 'http://e/', type: 'object', $defs: { x: { type: 'object', properties: { b: { type: 'string', default: 'inner' } } } }, properties: { p: { $ref: '#/$defs/x' } } } },
  };
  assert.strictEqual(new Validator(embedded).validate({ inner: { p: { b: 1 } } }).valid, false, 'validation applies the inner definition');
  for (const [path, fill] of Object.entries(fills(embedded))) {
    const d = fill({ inner: { p: {} } });
    assert.ok(d.inner.p.a === undefined, `${path}: the outer definition's default was filled under the embedded resource`);
    assert.ok(d.inner.p.b === undefined || d.inner.p.b === 'inner', `${path}: an unexpected value ${JSON.stringify(d.inner.p)}`);
  }
}

// The closure pass tests document keys against patternProperties with the
// engine validation uses, linear for the patterns it can take, not the
// backtracking one: with useDefaults on by default, a key the validator
// refuses in no time used to take seconds in the defaults pass first.
{
  const schema = { type: 'object', patternProperties: { '^(a+)+$': { type: 'object', properties: { x: { type: 'number', default: 1 } } } } };
  const key = 'a'.repeat(28) + '!';
  for (const engine of [undefined, 'interpreter']) {
    const v = new Validator(schema, { engine });
    v.validate({ a: {} });
    const t0 = process.hrtime.bigint();
    const r = v.validate({ [key]: {} });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.strictEqual(r.valid, true);
    assert.ok(ms < 200, `${engine || 'codegen'}: a key of 28 a's took ${ms.toFixed(0)} ms through the defaults pass`);
  }
  // the matcher still answers as the pattern says
  const d = new Validator(schema).validate({ aaa: {}, b: {} }).data;
  assert.deepStrictEqual(d, { aaa: { x: 1 }, b: {} });
}

// A schema applied to the same object through two edges is applied once per
// call: n_i = allOf [n_(i-1), n_(i-1)] with a default at the bottom cost 2^n
// visits of one object. The passes are timed on their own: the verdict on
// generated code follows every edge as well, which is not this pass's cost.
{
  const build = (n) => {
    const defs = { n0: { type: 'object', properties: { x: { type: 'number', default: 1 } } } };
    for (let i = 1; i <= n; i++) defs['n' + i] = { allOf: [{ $ref: '#/$defs/n' + (i - 1) }, { $ref: '#/$defs/n' + (i - 1) }] };
    return { $ref: '#/$defs/n' + n, $defs: defs };
  };
  const schema = build(22);
  // The runtime's two passes, as the validator builds them; the generated
  // one declines a schema this size and leaves it to the closure pass, which
  // a compiled module embeds as its text.
  const passes = { closure: require('../lib/defaults').buildDefaultsApplier(schema) };
  const gen = require('../lib/codegen-engine').buildPreprocess(schema, { useDefaults: true });
  if (gen) passes.generated = gen;
  for (const [path, pass] of Object.entries(passes)) {
    const fill = (d) => { pass(d); return d; };
    fill({ x: 1 });
    const t0 = process.hrtime.bigint();
    const d = fill({});
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.deepStrictEqual(d, { x: 1 }, path);
    assert.ok(ms < 200, `${path}: a 22-deep allOf chain took ${ms.toFixed(0)} ms in the defaults pass`);
  }
  const r = new Validator(build(12), { engine: 'interpreter' }).validate({});
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(r.data, { x: 1 });
}

// A shared definition with a large default, referenced many times: the
// generated pass wrote the default out at every reference, 10 MB of source
// for 200 references to a 50 KB default. It leaves such a schema to the
// closure pass, which holds the default once, and the fills are unchanged.
{
  const big = { blob: 'x'.repeat(50 * 1024) };
  const props = {};
  for (let i = 0; i < 200; i++) props['p' + i] = { $ref: '#/$defs/D' };
  const schema = { type: 'object', properties: props, $defs: { D: { type: 'object', properties: { v: { type: 'object', default: big } } } } };
  const src = require('../lib/codegen-engine').preprocessSource(schema, { useDefaults: true });
  assert.ok(src === null || src.length < 4 * big.blob.length, `the generated pass is ${src && src.length} characters`);
  const r = new Validator(schema).validate({ p0: {}, p7: {} });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.data.p0.v.blob, big.blob);
  assert.notStrictEqual(r.data.p0.v, r.data.p7.v, 'each fill is a fresh value');
}

console.log(`ok: defaults filled where ajv fills them, ${MATRIX.length} constructs; ${schemas} seeded schemas, ${docs} documents agree on the generated, closure and module passes`);
