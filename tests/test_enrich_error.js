'use strict';

const assert = require('assert');
const { enrich, reprValue } = require('../lib/enrich-error');

// 1. type error
{
  const e = enrich({
    keyword: 'type', instancePath: '/age', schemaPath: '#/properties/age/type',
    params: { type: 'integer' }, message: 'must be integer',
  }, { data: { age: 'not a number' } });
  assert.strictEqual(e.code, 'ATA1001');
  assert.strictEqual(e.path, '/age');
  assert.strictEqual(e.expected, 'integer');
  assert.strictEqual(e.received, '"not a number"');
  assert.strictEqual(e.docUrl, 'https://ata-validator.com/e/ATA1001');
}

// 2. minLength
{
  const e = enrich({
    keyword: 'minLength', instancePath: '/name', schemaPath: '#/properties/name/minLength',
    params: { limit: 3 }, message: 'must NOT have fewer than 3 characters',
  }, { data: { name: 'M' } });
  assert.strictEqual(e.code, 'ATA2001');
  assert.strictEqual(e.expected, 'string with ≥3 chars');
  assert.strictEqual(e.received, '"M"');
}

// 3. format email
{
  const e = enrich({
    keyword: 'format', instancePath: '/email', schemaPath: '#/properties/email/format',
    params: { format: 'email' }, message: 'must match format "email"',
  }, { data: { email: 'nope' } });
  assert.strictEqual(e.code, 'ATA3001');
  assert.strictEqual(e.expected, "format 'email'");
}

// 4. required
{
  const e = enrich({
    keyword: 'required', instancePath: '', schemaPath: '#/required',
    params: { missingProperty: 'email' }, message: "must have required property 'email'",
  }, { data: {} });
  assert.strictEqual(e.code, 'ATA7001');
  assert.strictEqual(e.expected, "property 'email'");
}

// 5. reprValue truncation
assert.strictEqual(reprValue('x'.repeat(100)).endsWith('..."'), true);
assert.strictEqual(reprValue({}), '{}');
assert.strictEqual(reprValue([1, 2, 3]), '[array, 3 items]');

// 6. back-compat aliases present
{
  const e = enrich({
    keyword: 'type', instancePath: '/x', schemaPath: '#/properties/x/type',
    params: { type: 'string' }, message: 'must be string',
  }, { data: { x: 1 } });
  assert.strictEqual(e.instancePath, '/x');
  assert.strictEqual(e.dataPath, '/x');
}

console.log('ok: enrich-error unit tests');
