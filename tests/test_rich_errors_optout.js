'use strict';

const assert = require('assert');
const { Validator } = require('..');

// richErrors: false MUST return exactly the v0.14 shape.
// Keys allowed in v0.14: keyword, instancePath, schemaPath, params, message, parentSchema (when verbose).
const v0_14_KEYS = new Set(['keyword', 'instancePath', 'schemaPath', 'params', 'message', 'parentSchema']);

const v = new Validator({
  type: 'object',
  properties: { email: { type: 'string', format: 'email' } },
  required: ['email'],
}, { richErrors: false });

const result = v.validate({ email: 'not-an-email' });
assert.strictEqual(result.valid, false);
assert.ok(Array.isArray(result.errors));
assert.ok(result.errors.length >= 1);

for (const err of result.errors) {
  for (const k of Object.keys(err)) {
    assert.ok(v0_14_KEYS.has(k),
      `richErrors:false leaked new field "${k}"; expected only v0.14 keys (${[...v0_14_KEYS].join(', ')})`);
  }
}

console.log('ok: richErrors:false preserves v0.14 shape');
