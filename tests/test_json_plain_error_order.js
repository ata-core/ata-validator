'use strict'

// validateJSON with richErrors off gives its errors in the order validate()
// does, whatever the size of the text. A document at or above the native
// walker's threshold (8 KB) is rejected unparsed and its errors are built on
// first read; the presentation layer passed that rejection through as it
// was, so its list came out in the order the function found the errors
// rather than in schema order. Found by a sweep of the entry points under
// option sets: two SchemaStore schemas (aspire-8.0, popxf-corr-1.0).
// Without the native engine every document is parsed and the two agreed
// already; the assertions hold either way.

const assert = require('assert')
const { Validator } = require('..')

const schema = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    properties: { c: { type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'array' }] } } },
    additionalProperties: false,
  },
}
const shape = (errs) => errs.map((e) => `${e.keyword} ${e.instancePath} ${e.schemaPath}`)

for (const pad of [0, 9000, 20000]) {
  const doc = { x: { c: { z: 1 }, extra: 1 }, zz: 1, p: { c: { s: 'a'.repeat(pad) } } }
  const v = new Validator(schema, { richErrors: false })
  const want = shape(v.validate(structuredClone(doc)).errors)
  assert.deepStrictEqual(want, [
    'type /zz #/additionalProperties/type',
    'oneOf /x/c/z #/additionalProperties/properties/c/additionalProperties/oneOf',
    'additionalProperties /x #/additionalProperties/additionalProperties',
  ], 'validate() gives schema order')
  const r = v.validateJSON(JSON.stringify(doc))
  assert.strictEqual(r.valid, false)
  assert.deepStrictEqual(shape(r.errors), want, `validateJSON gives the same order at ${pad} bytes of padding`)
  assert.strictEqual(r.errors, r.errors, 'the list is built once')
  // Serialized, it carries the errors and not the document: the large-text
  // rejection had no toJSON, so JSON.stringify wrote its private fields,
  // the whole input text among them, and no errors.
  const json = JSON.parse(JSON.stringify(r))
  assert.deepStrictEqual(Object.keys(json).sort(), ['errors', 'valid'], 'serializes as valid and errors only')
  assert.deepStrictEqual(json.errors.map((e) => e.keyword), want.map((s) => s.split(' ')[0]), 'and serializes the same errors')
}

// The two shapes this layer passes through unchanged.
{
  const v = new Validator({ type: 'object' }, { richErrors: false })
  const r = v.validateJSON('{bad')
  assert.strictEqual(r.valid, false)
  assert.strictEqual(r.errors[0].keyword, '__parse__', 'a syntax error is reported as before')
  const a = new Validator({ type: 'object' }, { richErrors: false, abortEarly: true })
  const big = '[' + '1,'.repeat(5000) + '1]'
  assert.strictEqual(a.validateJSON(big).errors[0].code, 'ATA9000', 'abortEarly keeps its stub')
}

console.log('ok: validateJSON with richErrors off orders errors as validate() does at every size')
