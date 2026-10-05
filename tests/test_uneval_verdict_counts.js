'use strict'

// A verdict for a node whose unevaluatedProperties is worked out at run time
// judges the node's anyOf and oneOf from the annotation pass, which already
// decides every branch, instead of running the branches a second time. The
// pass runs for objects only, so for any other value the keywords' own
// blocks must still run (the `else` genUnevalDynamicVerdict writes): a
// string against a oneOf of string and integer is valid, 1.5 is not, and
// dropping that branch accepted both. Held to the interpreted engine on every
// shape and value, through isValidObject(), validate() and validateJSON().

const assert = require('node:assert')
const { Validator } = require('..')

const schemas = [
  { $defs: { two: { oneOf: [{ required: ['c'], properties: { c: true } }, { required: ['d'], properties: { d: true } }] } }, oneOf: [{ $ref: '#/$defs/two' }, { required: ['b'], properties: { b: true } }, { required: ['xx'], patternProperties: { x: true } }], unevaluatedProperties: false },
  { oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'object', required: ['a'], properties: { a: true } }], unevaluatedProperties: false },
  { anyOf: [{ type: 'string', minLength: 2 }, { type: 'object', required: ['a'], properties: { a: { type: 'integer' } } }, { properties: { b: true }, required: ['b'] }], unevaluatedProperties: false },
  { anyOf: [{ properties: { a: true }, required: ['a'] }, { properties: { b: true }, required: ['b'] }], oneOf: [{ required: ['a'] }, { required: ['c'], properties: { c: true } }], unevaluatedProperties: false },
  { $defs: { n: { type: 'object', properties: { v: { type: 'integer' } }, oneOf: [{ required: ['v'] }, { required: ['kids'], properties: { kids: { type: 'array', items: { $ref: '#/$defs/n' } } } }], unevaluatedProperties: false } }, $ref: '#/$defs/n' },
  { oneOf: [{ type: 'string' }, { type: 'number' }], unevaluatedProperties: { type: 'string' } },
  { type: 'object', oneOf: [{ required: ['a'], properties: { a: true } }, { required: ['b'], properties: { b: true } }], unevaluatedProperties: false },
]
const docs = ['x', 'ab', 1, 1.5, true, null, [], [1], {}, { a: 1 }, { a: 'x' }, { b: 1 }, { c: 1 }, { d: 1 }, { c: 1, d: 1 }, { b: 1, c: 1 }, { xx: 1 }, { xx: 1, b: 1 }, { a: 1, b: 1 }, { a: 1, c: 1 }, { a: 1, z: 2 }, { v: 1 }, { v: 'x' }, { kids: [{ v: 1 }, { kids: [] }] }, { kids: [{ v: 1, q: 2 }] }, { e: 'str' }, { e: 1 }]

let compared = 0
for (const [i, raw] of schemas.entries()) {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...raw }
  const gen = new Validator(schema, { richErrors: false })
  const interp = new Validator(schema, { richErrors: false, engine: 'interpreter' })
  for (let r = 0; r < 70; r++) for (const d of docs) { gen.isValidObject(d); void gen.validate(d).errors }
  assert.strictEqual(gen.engine(), 'codegen', `schema ${i} runs on generated code`)
  for (const d of docs) {
    const want = interp.validate(d).valid
    const label = `schema ${i} on ${JSON.stringify(d)}`
    assert.strictEqual(gen.isValidObject(d), want, 'isValidObject, ' + label)
    assert.strictEqual(gen.validate(d).valid, want, 'validate, ' + label)
    assert.strictEqual(gen.validateJSON(JSON.stringify(d)).valid, want, 'validateJSON, ' + label)
    compared++
  }
}
// The cases the `else` exists for, stated once in plain terms.
{
  const v = new Validator({ oneOf: [{ type: 'string' }, { type: 'integer' }], unevaluatedProperties: false })
  assert.strictEqual(v.isValidObject('x'), true)
  assert.strictEqual(v.isValidObject(2), true)
  assert.strictEqual(v.isValidObject(1.5), false, 'a non-object value is still judged by the oneOf')
  assert.strictEqual(v.isValidObject(null), false)
  const a = new Validator({ anyOf: [{ type: 'string' }, { minimum: 10 }], unevaluatedProperties: false })
  assert.strictEqual(a.isValidObject(3), false, 'a non-object value is still judged by the anyOf')
  assert.strictEqual(a.isValidObject(12), true)
}
console.log(`ok: run-time unevaluatedProperties verdicts judge anyOf and oneOf from the annotation pass and agree with the interpreter (${schemas.length} schemas, ${compared} values)`)
