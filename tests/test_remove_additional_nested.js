'use strict'

// removeAdditional must strip unknown keys at every level the schema
// describes, and the codegen and closure preprocess paths must agree.
//
// They did not. The codegen path emitted one delete loop for the root and
// stopped, while the closure path recursed, so the same schema and the same
// document produced opposite verdicts depending only on whether the runtime
// allowed code generation: valid and stripped under a blocked-codegen CSP,
// invalid and untouched everywhere else. The codegen answer was also the one
// that disagreed with the default validator this option exists to match,
// which meant a nested request body Fastify would have accepted was rejected.
//
// Run this file twice, once with code generation blocked, to exercise both.

const { Validator } = require('..')

let failed = 0
const check = (name, cond) => {
  if (!cond) { console.error('FAIL ' + name); failed = 1 }
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    a: { type: 'number' },
    nested: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number' },
        deeper: {
          type: 'object',
          additionalProperties: false,
          properties: { y: { type: 'number' } },
          required: ['y'],
        },
      },
      required: ['x'],
    },
  },
  required: ['a', 'nested'],
}

const cases = [
  ['root extra', { a: 1, extra: 9, nested: { x: 1 } }, { a: 1, nested: { x: 1 } }],
  ['nested extra', { a: 1, nested: { x: 1, extra: 9 } }, { a: 1, nested: { x: 1 } }],
  ['third level extra', { a: 1, nested: { x: 1, deeper: { y: 2, extra: 9 } } }, { a: 1, nested: { x: 1, deeper: { y: 2 } } }],
  ['every level at once', { a: 1, e1: 1, nested: { x: 1, e2: 2, deeper: { y: 2, e3: 3 } } }, { a: 1, nested: { x: 1, deeper: { y: 2 } } }],
  ['nothing to strip', { a: 1, nested: { x: 1 } }, { a: 1, nested: { x: 1 } }],
]

for (const [name, input, want] of cases) {
  const data = JSON.parse(JSON.stringify(input))
  const v = new Validator(schema, { removeAdditional: true })
  const r = v.validate(data)
  check('accepts after stripping: ' + name, r.valid === true)
  check('strips to the schema shape: ' + name, JSON.stringify(data) === JSON.stringify(want))
}

// A nested value that is not an object must not throw the strip loop.
{
  const v = new Validator(
    { type: 'object', properties: { nested: { type: ['object', 'null'], additionalProperties: false, properties: { x: { type: 'number' } } } } },
    { removeAdditional: true },
  )
  let threw = false
  try { v.validate({ nested: null }) } catch { threw = true }
  check('a null in place of a nested object does not throw', threw === false)
  try { v.validate({ nested: 5 }) } catch { threw = true }
  check('a number in place of a nested object does not throw', threw === false)
}

// removeAdditional off leaves everything alone.
{
  const data = { a: 1, nested: { x: 1, extra: 9 } }
  const v = new Validator(schema, { removeAdditional: false })
  v.validate(data)
  check('off: input untouched', JSON.stringify(data) === JSON.stringify({ a: 1, nested: { x: 1, extra: 9 } }))
}

if (failed) process.exit(1)
console.log('removeAdditional: strips every level, both preprocess paths agree')
