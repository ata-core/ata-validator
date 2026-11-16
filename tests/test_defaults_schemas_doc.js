'use strict';

// A `default` inside a document given through `schemas`. validate() filled it,
// but isValidObject() decided whether to fill from the root schema's text
// alone, found no "default" there, and answered from the compiled function
// before the fill: `{}` against a required property with a default was valid
// to validate() and invalid to isValidObject(), and the object was left
// unfilled. Both now fill and agree, on both engines.

const assert = require('assert');
const { Validator } = require('..');

const ext = {
  $id: 'https://x.test/e',
  type: 'object',
  properties: { a: { type: 'number', default: 1 }, b: { default: 'x' } },
  required: ['a'],
  $defs: { o: { properties: { c: { default: 3 } }, required: ['c'] } },
};
const CASES = [
  [{ $ref: 'https://x.test/e' }, {}, { a: 1, b: 'x' }],
  [{ $ref: 'https://x.test/e#/$defs/o' }, {}, { c: 3 }],
  [{ properties: { p: { $ref: 'https://x.test/e' } }, required: ['p'] }, { p: {} }, { p: { a: 1, b: 'x' } }],
];

let checks = 0;
for (const [schema, data, filled] of CASES) {
  for (const engine of [undefined, 'interpreter']) {
    const label = `${JSON.stringify(schema)} ${engine || 'default'}`;
    for (const order of [['isValidObject', 'validate'], ['validate', 'isValidObject']]) {
      const v = new Validator(schema, { schemas: [ext], engine });
      for (const m of order) {
        const d = structuredClone(data);
        const r = v[m](d);
        assert.strictEqual(typeof r === 'boolean' ? r : r.valid, true, `${m} after ${order[0]} ${label}`);
        assert.deepStrictEqual(d, filled, `${m} fills ${label}`);
        checks += 2;
      }
    }
    assert.strictEqual(new Validator(schema, { schemas: [ext], engine }).isValidJSON(JSON.stringify(data)), true, `isValidJSON ${label}`);
    checks++;
    // useDefaults: false leaves the object alone and rejects it.
    const off = new Validator(schema, { schemas: [ext], engine, useDefaults: false });
    const d = structuredClone(data);
    assert.strictEqual(off.isValidObject(d), false, `useDefaults false ${label}`);
    assert.deepStrictEqual(d, data);
    checks += 2;
  }
}

// A schemas document without defaults keeps the quick path's answers.
const plain = { $id: 'https://x.test/p', type: 'object', required: ['a'] };
const pv = new Validator({ $ref: 'https://x.test/p' }, { schemas: [plain] });
assert.strictEqual(pv.isValidObject({}), false);
assert.strictEqual(pv.isValidObject({ a: 1 }), true);

console.log(`ok: defaults from a schemas document are filled by isValidObject as by validate (${checks} checks)`);
