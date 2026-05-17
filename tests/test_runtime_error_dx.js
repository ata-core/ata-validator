'use strict';

const assert = require('assert');
const { Validator, renderCompact, renderPretty } = require('..');

const schemaText = JSON.stringify({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 2 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0 },
  },
  required: ['name', 'email'],
}, null, 2);
const schema = JSON.parse(schemaText);

const v = new Validator(schema, { source: { path: 'schemas/user.json', content: schemaText } });

const r = v.validateJSON('{"name":"M","email":"not-an-email","age":-3}');
assert.strictEqual(r.valid, false);
assert.ok(r.errors.length >= 3);

const byCode = {};
for (const e of r.errors) byCode[e.code] = e;

assert.ok(byCode.ATA2001, 'minLength error missing');
assert.ok(byCode.ATA3001, 'format email error missing');
assert.ok(byCode.ATA2003, 'minimum error missing');

// dataFrame present (input was a string)
assert.ok(byCode.ATA3001.dataFrame, 'dataFrame should be set');
assert.strictEqual(byCode.ATA3001.dataFrame.text, '{"name":"M","email":"not-an-email","age":-3}');

// docUrl present
assert.strictEqual(byCode.ATA3001.docUrl, 'https://ata-validator.com/e/ATA3001');

// schemaSource present and pointing at the user's schema file
assert.ok(byCode.ATA3001.schemaSource, 'runtime schemaSource missing');
assert.strictEqual(byCode.ATA3001.schemaSource.file, 'schemas/user.json');

// Pre-parsed object: no dataFrame
const r2 = v.validate({ name: 'M', email: 'not-an-email', age: -3 });
for (const e of r2.errors) {
  assert.strictEqual(e.dataFrame, undefined, `dataFrame should be absent for object input, got ${JSON.stringify(e.dataFrame)}`);
}

// Renderers don't crash
assert.ok(renderCompact(r.errors, { color: 'never' }).length > 0);
assert.ok(renderPretty(r.errors, { color: 'never' }).length > 0);

console.log('ok: runtime error DX end-to-end');
