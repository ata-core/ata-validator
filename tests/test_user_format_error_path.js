'use strict';

// A custom format next to a shape the combined codegen declines (anyOf here)
// sends the error path through compileToJSCodegenWithErrors. That entry point
// emitted a call to the format's closure without binding it, so the first
// invalid document threw `_uf_<name> is not defined` instead of reporting the
// format error. Present since custom formats were added; caught by the
// 1.16.0 clean-install check through the compat shim.

const assert = require('node:assert');
const { Validator } = require('../index');
const { compileToJSCodegenWithErrors } = require('../lib/js-compiler');

const formats = { slug: (x) => /^[a-z-]+$/.test(x) };
const schema = {
  type: 'object',
  properties: {
    s: { type: 'string', format: 'slug' },
    n: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['s'],
};

{
  const v = new Validator(schema, { formats });
  const r = v.validate({ s: 'A', n: null });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].keyword, 'format');
  assert.strictEqual(r.errors[0].instancePath, '/s');
  assert.strictEqual(v.validate({ s: 'ok', n: null }).valid, true);
  assert.strictEqual(v.validate({ s: 'ok', n: 1 }).valid, false, 'anyOf still enforced');
}

// The entry point on its own, with the format supplied, must bind it.
{
  const errFn = compileToJSCodegenWithErrors(schema, null, formats);
  assert.ok(errFn, 'error codegen accepts the schema');
  const r = errFn({ s: 'A', n: null }, true);
  assert.strictEqual(r.valid, false);
  assert.deepStrictEqual(r.errors.map((e) => e.keyword), ['format']);
}

// Two custom formats, one of them named with characters that are not valid
// in an identifier, both bound.
{
  const v = new Validator(
    { properties: { a: { type: 'string', format: 'x-id' }, b: { type: 'string', format: 'slug' }, c: { anyOf: [{ type: 'number' }] } } },
    { formats: { slug: formats.slug, 'x-id': (x) => x.length === 3 } },
  );
  const r = v.validate({ a: 'toolong', b: 'A', c: 1 });
  assert.strictEqual(r.valid, false);
  assert.deepStrictEqual(r.errors.map((e) => e.instancePath).sort(), ['/a', '/b']);
}

console.log('ok: custom formats are bound on the error codegen path');
