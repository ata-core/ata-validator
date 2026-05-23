'use strict';

// Runtime behavior of defineSchema(): it is an identity function. The value is
// entirely in the TypeScript signature (see tests/test_define_schema.ts), so at
// runtime it must return the exact object it was given, untouched.

const assert = require('node:assert/strict');
const { defineSchema } = require('../index.js');

const schema = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 } },
  required: ['id'],
};

const out = defineSchema(schema);
assert.strictEqual(out, schema, 'defineSchema must return the same object reference');
assert.deepEqual(out, schema, 'defineSchema must not mutate the schema');

// The schema must drop straight into the public API unchanged.
const { Validator } = require('../index.js');
const v = new Validator(out);
assert.equal(v.validate({ id: 1 }).valid, true);
assert.equal(v.validate({}).valid, false);

// ESM consumers must get the same named export.
(async () => {
  const esm = await import('../index.mjs');
  assert.equal(typeof esm.defineSchema, 'function', 'defineSchema must be an ESM named export');
  assert.strictEqual(esm.defineSchema(schema), schema, 'ESM defineSchema must also be identity');
  console.log('defineSchema runtime identity passes');
})();
