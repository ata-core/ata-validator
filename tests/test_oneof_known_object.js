'use strict';

// A oneOf under `type: object` writes its branches for an object already
// checked. The same branch schema reached where the type is not known must
// keep its own type test, so the two are separate functions, and both must
// answer as the interpreter does.

const assert = require('assert');
const { Validator } = require('..');

const src = { required: ['src'], properties: { src: { type: 'string' } } };
const handle = { required: ['handle'], properties: { handle: { const: 'filesystem' } } };
const schemas = [
  { type: 'object', oneOf: [src, handle] },
  { oneOf: [src, handle] },
  { type: 'array', items: { type: 'object', oneOf: [src, handle] } },
  { properties: { typed: { type: 'object', oneOf: [src, handle] }, loose: { oneOf: [src, handle] } } },
  { properties: { loose: { oneOf: [src, handle] }, typed: { type: 'object', oneOf: [src, handle] } } },
  { type: 'object', oneOf: [{ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }, { not: { required: ['a'] } }] },
];
const values = [
  { src: 'x' }, { handle: 'filesystem' }, { src: 'x', handle: 'filesystem' }, { src: 1 }, { handle: 'other' }, {},
  Object.create({ src: 'x' }), Object.assign(Object.create({ src: 'x' }), { handle: 'filesystem' }), [], ['x'], 'text', 5, null,
  { a: 1 }, { a: 'x' }, { b: 1 },
];
let checked = 0;
for (const schema of schemas) {
  const v = new Validator(schema);
  const vi = new Validator(schema, { engine: 'interpreter' });
  const docs = [...values, ...values.map((x) => [x]), ...values.map((x) => ({ typed: x, loose: x })), ...values.map((x) => ({ typed: { src: 'x' }, loose: x })), ...values.map((x) => ({ typed: x, loose: { src: 'x' } }))];
  for (const d of docs) {
    const want = vi.validate(d).valid;
    assert.strictEqual(v.validate(d).valid, want, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`);
    assert.strictEqual(v.isValidObject(d), want, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`);
    checked++;
  }
}
console.log(`ok: oneOf branches written for a known object agree with the interpreter (${checked} documents)`);
