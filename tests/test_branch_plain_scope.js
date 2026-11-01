'use strict'

// A branch of anyOf/oneOf is written as a function of its own, hoisted out
// of the function that reaches it, and takes its value as `_bv`. The
// ordinary-object flag (`_pkN`) an enclosing branch declared for its own
// `_bv` was still on record while a nested branch body was written, so the
// nested body read a flag that is not in its scope: reading the errors threw
// `ReferenceError: _pk1 is not defined`. Had the flag been in scope it would
// have described another object. Found by the SchemaStore differential on
// prometheus.rules.json; published in 1.62.1. Hoisted props, definitions and
// the root already went through isolatedE; branch bodies did not.

const assert = require('assert')
const { Validator } = require('..')

const AP = { additionalProperties: false }
const CASES = [
  ['anyOf > properties > anyOf > oneOf > additionalProperties', { anyOf: [{ properties: { r: { anyOf: [{ oneOf: [AP] }] } } }] }, { r: { a: 1 } }],
  ['anyOf > properties > oneOf > additionalProperties', { anyOf: [{ properties: { r: { oneOf: [AP] } } }] }, { r: { a: 1 } }],
  ['oneOf > properties > anyOf > oneOf > additionalProperties', { oneOf: [{ properties: { r: { anyOf: [{ oneOf: [AP] }] } } }] }, { r: { a: 1 } }],
  ['two branches each side', { anyOf: [{ properties: { r: { anyOf: [{ oneOf: [AP, { type: 'string' }] }, { type: 'number' }] } } }, { type: 'string' }] }, { r: { a: 1 } }],
  ['prometheus.rules shape', {
    definitions: { alerting_rule: { additionalProperties: false } },
    anyOf: [{ properties: { groups: { anyOf: [{ items: { properties: { rules: { anyOf: [{ items: { oneOf: [{ $ref: '#/definitions/alerting_rule' }] } }] } } } }] } } }],
  }, { groups: [{ rules: [{ annotations: {} }] }] }],
]

let n = 0
for (const [name, schema, doc] of CASES) {
  for (const richErrors of [true, false]) {
    const gen = new Validator(schema, { richErrors })
    gen._coldCalls = 64
    const interp = new Validator(schema, { richErrors, engine: 'interpreter' })
    let a
    assert.doesNotThrow(() => { a = JSON.stringify(gen.validate(JSON.parse(JSON.stringify(doc)))) }, `${name} (rich ${richErrors}): reading the errors throws`)
    const b = JSON.stringify(interp.validate(JSON.parse(JSON.stringify(doc))))
    assert.strictEqual(a, b, `${name} (rich ${richErrors}): generated errors differ from the interpreter`)
    n++
  }
}
console.log(`ok: ${n} nested branch cases read their errors as the interpreter does`)
