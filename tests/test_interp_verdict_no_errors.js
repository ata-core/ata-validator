'use strict'

// On the interpreted engine, a schema with a preprocess pass (defaults here)
// answers isValidObject() from the pass and the interpreter's verdict, as
// validate() does. It went through validate() and built the error list of
// every document it was asked about: a prometheus configuration took 40 us a
// check where the verdict takes 5.

const assert = require('node:assert')
const interpMod = require('../lib/interpreter.js')
const real = interpMod.createInterpreter
let built = null
interpMod.createInterpreter = (schema, args) => { built = real(schema, args); return built }
const { Validator } = require('..')

const schema = {
  type: 'object',
  properties: { a: { type: 'integer', default: 5 }, b: { type: 'string' }, c: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
  required: ['b'],
}
const v = new Validator(schema, { engine: 'interpreter' })
v.isValidObject({ b: 'warm' })
assert.ok(built, 'the interpreted engine was built')
let collected = 0
const validate = built.validate
built.validate = function (d) { collected++; return validate.call(this, d) }

const cases = [[{ b: 'x' }, true], [{ b: 'x', c: 1 }, true], [{ a: 'q', b: 'x' }, false], [{ c: true, b: 'x' }, false], [{}, false]]
for (const [doc, want] of cases) {
  const copy = JSON.parse(JSON.stringify(doc))
  assert.strictEqual(v.isValidObject(copy), want, JSON.stringify(doc))
  if (!Object.hasOwn(doc, 'a')) assert.strictEqual(copy.a, 5, 'the default is applied by the verdict: ' + JSON.stringify(doc))
}
assert.strictEqual(collected, 0, 'isValidObject() built no error list')
for (const [doc, want] of cases) assert.strictEqual(v.validate(JSON.parse(JSON.stringify(doc))).valid, want, 'validate() agrees: ' + JSON.stringify(doc))

console.log(`ok: the interpreted engine answers isValidObject() with a preprocess pass without building errors (${cases.length} documents)`)
