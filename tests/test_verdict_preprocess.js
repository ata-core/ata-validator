'use strict'

// A verdict method answers the same question as validate(), without building
// the error list. With coerceTypes, removeAdditional or a schema default in
// play, they used to answer a different one: validate() ran the preprocess
// pass and the verdict methods did not, so the same validator called
// isValidObject({ age: '26' }) said false while validate({ age: '26' }) said
// true. These tests hold every verdict path to validate()'s answer.

const assert = require('assert')
const { Validator } = require('../index.js')

let pass = 0
function ok (name, fn) {
  fn()
  pass++
  console.log('  PASS ', name)
}

const schema = {
  type: 'object',
  required: ['age', 'active'],
  additionalProperties: false,
  properties: {
    age: { type: 'integer', minimum: 13 },
    active: { type: 'boolean', default: true },
    name: { type: 'string' },
  },
}

// Each case: what a client sends, and whether the schema accepts it once the
// configured preprocessing has run.
const CASES = [
  { label: 'query string values', data: () => ({ age: '26' }), valid: true },
  { label: 'boolean as a string', data: () => ({ age: 26, active: 'false' }), valid: true },
  { label: 'unknown key', data: () => ({ age: 26, junk: 1 }), valid: true },
  { label: 'a value no coercion can fix', data: () => ({ age: 'old' }), valid: false },
  { label: 'below the minimum after coercion', data: () => ({ age: '4' }), valid: false },
  // Coercion turns a number into a string, so this one is accepted; an object
  // is not something coercion touches, so that one is not.
  { label: 'number for a string field', data: () => ({ age: 26, name: 7 }), valid: true },
  { label: 'object for a string field', data: () => ({ age: 26, name: {} }), valid: false },
]

const OPTIONS = [
  { label: 'coerceTypes + removeAdditional', opts: { coerceTypes: true, removeAdditional: true } },
  { label: 'coerceTypes alone', opts: { coerceTypes: true, removeAdditional: false } },
]

for (const { label: optLabel, opts } of OPTIONS) {
  for (const c of CASES) {
    // removeAdditional is off in the second group, so an unknown key is a
    // rejection there rather than something to strip.
    const expected = c.label === 'unknown key' && !opts.removeAdditional ? false : c.valid

    ok(`${optLabel}: validate agrees with isValidObject on ${c.label}`, () => {
      const v = new Validator(schema, opts)
      assert.strictEqual(v.validate(c.data()).valid, expected)
      assert.strictEqual(v.isValidObject(c.data()), expected)
    })

    ok(`${optLabel}: validateJSON agrees with isValidJSON on ${c.label}`, () => {
      const v = new Validator(schema, opts)
      const text = JSON.stringify(c.data())
      assert.strictEqual(v.validateJSON(text).valid, expected)
      assert.strictEqual(v.isValidJSON(text), expected)
    })
  }
}

ok('a verdict method applies defaults the same way validate does', () => {
  const v = new Validator(schema, { coerceTypes: true })
  const a = { age: 26 }
  const b = { age: 26 }
  assert.strictEqual(v.validate(a).valid, true)
  assert.strictEqual(v.isValidObject(b), true)
  assert.strictEqual(a.active, true)
  assert.strictEqual(b.active, true, 'isValidObject must fill the default too')
})

ok('a verdict method coerces in place, like validate', () => {
  const v = new Validator(schema, { coerceTypes: true })
  const d = { age: '26' }
  v.isValidObject(d)
  assert.strictEqual(d.age, 26)
})

ok('without preprocessing options nothing is mutated', () => {
  const v = new Validator(schema, { useDefaults: false })
  const d = { age: 26, active: true }
  assert.strictEqual(v.isValidObject(d), true)
  assert.deepStrictEqual(d, { age: 26, active: true })
})

console.log(`${pass}/${CASES.length * OPTIONS.length * 2 + 3} verdict preprocess tests passed.`)
