'use strict'

// A verdict generated for a subschema (nestedGenCode, and the inline
// annotation verdicts behind run-time unevaluatedProperties and
// unevaluatedItems) must never defer a check to the end of the root function:
// its lines go into a block or a function of their own and nothing flushes
// the deferred list for them. In 1.46.0 an anyOf or oneOf branch holding
// `additionalProperties: { const: true }` at the root lost that check, read
// as holding for every object, and the one-pass function (what validate()
// runs once errors have been read) accepted documents the interpreter and
// the verdict rejected. Held here on every entry point, after enough reads
// that the one-pass function is the one answering.

const assert = require('node:assert')
const { Validator } = require('..')

const schemas = [
  { if: {}, then: {}, anyOf: [{}, { properties: { b: false }, additionalProperties: { const: true } }], unevaluatedProperties: false },
  { anyOf: [{}, { additionalProperties: { const: true } }], unevaluatedProperties: false },
  { oneOf: [{ type: 'string' }, { additionalProperties: { const: true } }], unevaluatedProperties: false },
  { anyOf: [{ type: 'string' }, { properties: { a: true }, additionalProperties: false }], unevaluatedProperties: false },
  { anyOf: [{ type: 'string' }, { items: { const: 1 } }], unevaluatedItems: false },
  { allOf: [{ anyOf: [{ additionalProperties: { type: 'integer' } }, { required: ['s'], properties: { s: { type: 'string' } } }] }], unevaluatedProperties: false },
  { not: { additionalProperties: { const: true } } },
  { properties: { k: { not: { additionalProperties: { type: 'string' } } } } },
]
const docs = [{}, { c: null }, { c: true }, { a: 1, z: 2 }, { a: 1 }, { s: 'x', t: 1 }, { s: 1 }, { k: { q: 1 } }, { k: { q: 'x' } }, [1, 1], [1, 2], 'str', 3]

let compared = 0, rejected = 0
schemas.forEach((schema, i) => {
  const gen = new Validator(schema, { richErrors: false })
  const interp = new Validator(schema, { engine: 'interpreter' })
  for (let r = 0; r < 70; r++) for (const d of docs) { gen.isValidObject(d); void gen.validate(d).errors }
  assert.strictEqual(gen.engine(), 'codegen', `schema ${i} runs on generated code`)
  for (const d of docs) {
    const want = interp.validate(d).valid
    const label = `schema ${i} on ${JSON.stringify(d)}`
    assert.strictEqual(gen.isValidObject(d), want, 'isValidObject, ' + label)
    assert.strictEqual(gen.validate(d).valid, want, 'validate, ' + label)
    assert.strictEqual(gen.validateJSON(JSON.stringify(d)).valid, want, 'validateJSON, ' + label)
    if (!want) rejected++
    compared++
  }
})
assert.ok(rejected >= 20)
console.log(`ok: subschema verdicts keep their additionalProperties and items checks on every entry point (${schemas.length} schemas, ${compared} values, ${rejected} rejected)`)
