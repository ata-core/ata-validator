'use strict';

// A node without `type: object` applies `properties` and `required` to
// objects only. Generated code tested `typeof v === 'object'`, which arrays
// pass, and checked an array's own `length` against a property of that name:
// `[1, 2]` was rejected by `{ properties: { length: { maximum: 1 } } }`.
// A required key there is read before it is asked whether it is the object's
// own; inherited and undefined values must still not count.

const assert = require('assert');
const { Validator } = require('..');

const schemas = [
  { properties: { length: { maximum: 1 } } },
  { required: ['length', 'map'], properties: { length: { type: 'integer', maximum: 1 }, map: { type: 'string' } } },
  { oneOf: [{ required: ['src'], properties: { src: { type: 'string' } } }, { required: ['h'], properties: { h: { const: 'x' } } }] },
  { required: ['toString'], properties: { toString: { type: 'string' } } },
  { anyOf: [{ required: ['a'], properties: { a: { type: 'number' } } }, { type: 'array' }] },
  { properties: { 0: { type: 'string' }, 1: { maximum: 0 } } },
  { properties: { map: { type: 'string' }, push: { type: 'number' } } },
];
const docs = [
  [], [1], [1, 2], [1, 2, 3], {}, { length: 0 }, { length: 3 }, { length: 0, map: 'x' }, { src: 'a' }, { src: 1 },
  { h: 'x' }, { h: 'y' }, { src: 'a', h: 'x' }, { src: undefined }, Object.create({ src: 'a' }), { toString: 'x' },
  Object.create({ a: 1 }), { a: 1 }, { a: '1' }, 'text', 5, null, ['x', 5], [1], { 0: 'x' }, { 0: 1 }, { map: 1 },
];
let checked = 0;
for (const schema of schemas) {
  const v = new Validator(schema);
  const vi = new Validator(schema, { engine: 'interpreter' });
  for (const d of docs) {
    const want = vi.validate(d).valid;
    assert.strictEqual(v.validate(d).valid, want, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`);
    assert.strictEqual(v.isValidObject(d), want, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`);
    checked++;
  }
}
console.log(`ok: properties and required without type: object skip arrays and agree with the interpreter (${checked} documents)`);
