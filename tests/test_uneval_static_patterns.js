'use strict';
// unevaluatedProperties: false whose evaluated names are fixed at compile
// time, from properties and patternProperties applied unconditionally (own,
// allOf, local $ref) with conditional branches that add no new name, is
// checked by one walk of the keys (staticUnevalPatterns in
// lib/js-compiler.js). The generated code must answer as the interpreted
// engine on the documents where that could go wrong: an anyOf or oneOf beside
// it that no branch satisfies (genCodeNode must still write them), a
// conditional branch that adds a name of its own (the model must decline),
// pattern subschemas that reject, nested and cyclic references, patterns
// that are not plain prefixes, inherited keys, and name tables large enough
// to be hoisted.
const assert = require('assert');
const { Validator } = require('..');

const ext = { patternProperties: { '^x-': true } };
const closed = (extra) => ({
  $defs: { ext, extF: { patternProperties: { '^x-': false } }, num: { patternProperties: { '^[0-9]{3}$': { type: 'integer' } } } },
  type: 'object',
  properties: { a: { type: 'string' }, b: { type: 'integer' } },
  $ref: '#/$defs/ext',
  unevaluatedProperties: false,
  ...extra,
});

const big = Object.fromEntries(Array.from({ length: 24 }, (_, i) => ['p' + i, { type: 'integer' }]));
const cases = {
  'own names and a referenced prefix pattern': closed({}),
  'a pattern whose subschema is false': closed({ $ref: '#/$defs/extF' }),
  'a general pattern': closed({ $ref: '#/$defs/num' }),
  'allOf adds names': closed({ allOf: [{ properties: { c: true } }, { $ref: '#/$defs/num' }] }),
  'anyOf of required names': closed({ anyOf: [{ required: ['a'] }, { required: ['b'] }] }),
  'oneOf of required names': closed({ oneOf: [{ required: ['a'] }, { required: ['b'] }] }),
  'not beside it': closed({ not: { required: ['a', 'b'] } }),
  'if/then within the names': closed({ if: { properties: { a: { const: 'q' } }, required: ['a'] }, then: { properties: { b: { minimum: 5 } } } }),
  'then adds a name of its own': closed({ if: { properties: { a: { const: 'q' } }, required: ['a'] }, then: { properties: { c: true } } }),
  'else adds a pattern of its own': closed({ if: { required: ['a'] }, else: { patternProperties: { '^y-': true } } }),
  'dependentSchemas within the names': closed({ dependentSchemas: { a: { properties: { b: { maximum: 9 } } } } }),
  'dependentSchemas adds a name': closed({ dependentSchemas: { a: { properties: { c: true } } } }),
  'anyOf branch adds a name': closed({ anyOf: [{ properties: { c: true }, required: ['c'] }, { required: ['a'] }] }),
  'nested definitions': {
    $defs: { outer: { $defs: { inner: { patternProperties: { '^x-': true }, properties: { z: { type: 'boolean' } } } } } },
    type: 'object', properties: { a: true }, allOf: [{ $ref: '#/$defs/outer/$defs/inner' }], unevaluatedProperties: false,
  },
  'a cyclic reference': {
    $defs: { loop: { patternProperties: { '^x-': true }, allOf: [{ $ref: '#/$defs/loop' }] } },
    type: 'object', properties: { a: true }, $ref: '#/$defs/loop', unevaluatedProperties: false,
  },
  'a unicode pattern': { $defs: { u: { patternProperties: { '^\\p{Lu}': true } } }, properties: { a: true }, $ref: '#/$defs/u', unevaluatedProperties: false },
  'a large name table': { $defs: { ext }, type: 'object', properties: { ...big, toString: { type: 'string' } }, $ref: '#/$defs/ext', unevaluatedProperties: false },
  'nested under a property': { $defs: { ext }, type: 'object', properties: { inner: closed({}) }, $ref: '#/$defs/ext', unevaluatedProperties: false },
};

const docs = [
  {}, { a: 's' }, { a: 's', b: 1 }, { a: 's', 'x-1': 0 }, { a: 's', 'x-': null }, { 'x-only': 1 }, { a: 's', c: 1 }, { a: 's', y: 1 },
  { a: 's', 'X-1': 1 }, { a: 's', '123': 4 }, { a: 's', '123': 'no' }, { a: 's', '1234': 4 }, { a: 'q', b: 7 }, { a: 'q', b: 1 }, { a: 'q', c: 1 },
  { b: 1 }, { b: 1, 'y-1': 1 }, { a: 's', 'y-1': 1 }, { a: 's', b: 99 }, { a: 'q' }, { z: true }, { a: 1, z: true }, { a: 's', Élan: 1 }, { a: 's', élan: 1 },
  { p0: 1, p23: 2, toString: 's' }, { p0: 1, 'x-k': 1 }, { p0: 'no' }, { p0: 1, q: 1 }, { inner: { a: 's' } }, { inner: { a: 's', c: 1 } }, { inner: { 'x-1': 1 } },
  JSON.parse('{"a":"s","__proto__":1}'), Object.assign(Object.create({ c: 1 }), { a: 's' }), Object.assign(Object.create({ a: 's' }), { 'x-1': 1 }),
  Object.assign(Object.create(null), { a: 's', c: 1 }), Object.assign(Object.create(null), { a: 's', 'x-2': 1 }),
  [], ['a'], 's', 1, null, true,
];

let n = 0;
for (const [name, schema] of Object.entries(cases)) {
  const gen = new Validator(schema);
  const interp = new Validator(schema, { engine: 'interpreter' });
  for (const d of docs) {
    const want = interp.validate(d).valid;
    for (let i = 0; i < 3; i++) assert.strictEqual(gen.isValidObject(d), want, `${name}: verdict call ${i} on ${JSON.stringify(d)}`);
    assert.strictEqual(gen.validate(d).valid, want, `${name}: validate() on ${JSON.stringify(d)}`);
    assert.strictEqual(interp.isValidObject(d), want, `${name}: interpreter verdict on ${JSON.stringify(d)}`);
    n++;
  }
  // A reference cycle is declined by the generator before this model is
  // asked; the interpreted engine answers it.
  if (name !== 'a cyclic reference') assert.ok(gen._jsFn, `${name}: compiled to generated code, so the check above tested it`);
}
console.log(`ok: fixed unevaluated sets answer as the interpreted engine, ${Object.keys(cases).length} schemas, ${n} documents`);
