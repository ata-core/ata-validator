'use strict'

// A definition on a reference cycle is compiled as a function hoisted above the
// entry function. When its body referred back to the root (`$ref: '#'`), the
// generated code called `_validate`, which is not in scope up there, and
// validate() threw `ReferenceError: _validate is not defined` for any document
// that reached it, from at least 1.20.0 to 1.35.0. Found through SchemaStore's
// jsone schema, shrunk to the first case here. Such a schema now goes to an
// engine that can answer it; the answers must match the interpreted engine's.

const assert = require('assert')
const { Validator } = require('..')

const SCHEMAS = [
  { $defs: { v: { anyOf: [{ $ref: '#' }, { items: { $ref: '#/$defs/v' } }] } }, additionalProperties: { $ref: '#/$defs/v' } },
  { $defs: { v: { oneOf: [{ $ref: '#' }, { type: 'array', items: { $ref: '#/$defs/v' } }] } }, type: 'object', additionalProperties: { $ref: '#/$defs/v' } },
  { $defs: { v: { anyOf: [{ type: 'string' }, { $ref: '#' }] } }, type: 'object', properties: { a: { $ref: '#/$defs/v' } } },
]
const DOCS = [{ 'by(x)': 'x' }, {}, { a: 'x' }, { a: { a: 'y' } }, { a: 1 }, { k: [{ k: [] }] }, [], 'x']
const shape = (r) => JSON.stringify(r.valid ? true : r.errors.map((e) => [e.keyword, e.instancePath]))

let compared = 0
for (const schema of SCHEMAS) {
  const fast = new Validator(schema), interp = new Validator(schema, { engine: 'interpreter' })
  for (const d of DOCS) {
    let a
    assert.doesNotThrow(() => { a = fast.validate(structuredClone(d)) }, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    assert.strictEqual(shape(a), shape(interp.validate(structuredClone(d))), `${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    assert.strictEqual(fast.isValidObject(structuredClone(d)), interp.isValidObject(structuredClone(d)))
    compared++
  }
}
console.log(`ok: a hoisted definition that refers to the root no longer throws, and agrees with the interpreter (${compared} documents)`)
