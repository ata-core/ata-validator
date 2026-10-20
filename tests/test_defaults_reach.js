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

console.log(`ok: defaults filled where ajv fills them, ${MATRIX.length} constructs; ${schemas} seeded schemas, ${docs} documents agree on the generated, closure and module passes`);
