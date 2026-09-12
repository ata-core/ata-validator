'use strict';

// The rejection object validate() builds behind a failing verdict: what it
// must keep looking like while its construction changes. Errors are read
// lazily and cached, the raw list is schema-ordered, JSON.stringify sees
// the errors, and a shared frozen rejection is never mutated.

const assert = require('node:assert');
const { Validator } = require('../index');

const schema = { type: 'object', properties: { a: { type: 'number' }, b: { type: 'string' } }, required: ['a', 'b'] };

for (const richErrors of [true, false]) {
  const v = new Validator(schema, { richErrors });
  const r = v.validate({ a: 'x' });
  assert.strictEqual(r.valid, false);
  const first = r.errors;
  assert.strictEqual(r.errors, first, 'errors are built once and cached');
  assert.deepStrictEqual(first.map((e) => e.keyword + '@' + e.instancePath), ['type@/a', 'required@']);
  const json = JSON.parse(JSON.stringify(r));
  assert.strictEqual(json.valid, false);
  assert.strictEqual(json.errors.length, 2, 'JSON.stringify includes the errors');
  if (richErrors) {
    assert.strictEqual(first[0].code, 'ATA1001');
    assert.strictEqual(typeof first[0].docUrl, 'string');
  } else {
    assert.deepStrictEqual(Object.keys(first[0]).sort(), ['instancePath', 'keyword', 'message', 'params', 'schemaPath']);
  }
  if (typeof r._ataRaw === 'function') {
    const raw = r._ataRaw();
    assert.deepStrictEqual(raw.map((e) => e.keyword), ['type', 'required']);
  }
}

// validateJSON attaches data frames through the same object.
{
  const v = new Validator(schema);
  const r = v.validateJSON('{"a": "x"}');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors[0].keyword, 'type');
  assert.ok(r.errors[0].dataFrame, 'position frame from the JSON text');
}

// Ten thousand rejections read back correctly (no shared mutable state).
{
  const v = new Validator(schema);
  for (let i = 0; i < 10000; i++) {
    const r = v.validate({ a: String(i) });
    if (r.errors.length !== 2 || r.errors[0].instancePath !== '/a') throw new Error('rejection ' + i + ' wrong');
  }
}

console.log('ok: rejection object shape');
