'use strict';

// A schema with `unevaluatedProperties` or `unevaluatedItems` compiles to
// generated code for the verdict, but the error generator declines those
// keywords. The error path used to answer with a placeholder,
// `{ code: 'unevaluated', message: 'unevaluated property or item' }`, with no
// keyword and no instancePath, whatever actually failed: a wrong type three
// levels down came back as that one line. The interpreted engine reports
// these schemas correctly, so the error path re-validates there instead.
// Found by a user comparing error output against the default validator on a
// generated config schema (root `unevaluatedProperties: false`).

const assert = require('node:assert');
const { Validator } = require('../index');
const { createInterpreter } = require('../lib/interpreter');

// validate() applies declaration order on top; compare the sets.
const keys = (errors) => errors.map((e) => `${e.keyword}@${e.instancePath}`).sort();

const cases = [
  {
    name: 'nested type error under a root unevaluatedProperties: false',
    schema: { type: 'object', properties: { a: { type: 'number' } }, unevaluatedProperties: false },
    data: { a: 'x' },
  },
  {
    name: 'an unevaluated property itself',
    schema: { type: 'object', properties: { a: { type: 'number' } }, unevaluatedProperties: false },
    data: { a: 1, b: 2 },
  },
  {
    name: 'required, format and enum three levels down',
    schema: {
      type: 'object',
      properties: {
        server: {
          type: 'object',
          properties: {
            host: { type: 'string', format: 'hostname' },
            mode: { enum: ['dev', 'prod'] },
            port: { type: 'integer' },
          },
          required: ['port'],
        },
      },
      unevaluatedProperties: false,
    },
    data: { server: { host: 'not a host!', mode: 'staging' } },
  },
  {
    name: 'unevaluatedItems',
    schema: { type: 'array', prefixItems: [{ type: 'string' }], unevaluatedItems: false },
    data: [1, 'extra'],
  },
  {
    name: 'allOf with unevaluatedProperties, the property is evaluated by a branch',
    schema: { allOf: [{ properties: { a: { type: 'number' } } }], unevaluatedProperties: false },
    data: { a: 'x' },
  },
];

for (const { name, schema, data } of cases) {
  const v = new Validator(schema);
  const r = v.validate(data);
  assert.strictEqual(r.valid, false, name + ': invalid');
  const expected = createInterpreter(schema, {}).validate(data).errors;
  assert.deepStrictEqual(keys(r.errors), keys(expected), name + ': same errors as the interpreter');
  for (const e of r.errors) {
    assert.strictEqual(typeof e.keyword, 'string', name + ': every error names its keyword');
    assert.notStrictEqual(e.code, 'unevaluated', name + ': no placeholder error');
  }
  assert.strictEqual(v.validate(data).valid, false, name + ': stable on a second call');
}

// The verdict is untouched: valid data is still valid on the same schema.
{
  const v = new Validator(cases[2].schema);
  assert.strictEqual(v.validate({ server: { host: 'example.com', mode: 'dev', port: 80 } }).valid, true);
  assert.strictEqual(v.isValidObject({ server: { port: 80 } }), true);
}

console.log('ok: unevaluated* schemas report real errors on the generated-code path');
