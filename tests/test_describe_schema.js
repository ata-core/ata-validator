'use strict'

// describeSchema turns a schema into the description that goes in a model's
// prompt. What is held here is not the wording but the property that made it
// worth writing: every constraint a model has to satisfy appears in the text.
//
// The measurement behind it, one model, first attempt only, 30 documents, no
// retry: nothing 0 of 30 valid, a hand-written field list 0 of 30, a careful
// hand-written description 0 of 30, this 23 of 30. The careful one failed on
// exactly the two fields whose values are an internal vocabulary, in all 30
// cases, because a person describes a field and a generator lists its values.

const assert = require('node:assert')
const { describeSchema } = require('..')

let checks = 0
const ok = (name, cond) => { assert.strictEqual(cond, true, name); checks++ }

// --- the case the measurement turned on ------------------------------------
{
  const text = describeSchema({
    type: 'object',
    required: ['status'],
    additionalProperties: false,
    properties: { status: { enum: ['AWAITING_CLEARANCE', 'PART_SETTLED', 'CLOSED_OUT'] } },
  })
  ok('every enum value is listed',
    ['AWAITING_CLEARANCE', 'PART_SETTLED', 'CLOSED_OUT'].every((v) => text.includes(v)))
  ok('a closed object says so', /no other fields/.test(text))
}

// --- constraints a model has to satisfy ------------------------------------
{
  const text = describeSchema({
    type: 'object',
    required: ['id', 'when'],
    properties: {
      id: { type: 'string', pattern: '^INV-[0-9]{6}$' },
      when: { type: 'string', format: 'date-time' },
      total: { type: 'number', minimum: 0, multipleOf: 0.01 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      tags: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string' } },
      kind: { const: 'invoice' },
    },
  })
  for (const needle of ['^INV-[0-9]{6}$', 'date-time', 'rounded to 2 decimal places', 'at least 0',
    '1 to 120 characters', '1 to 5 items', 'all items different', 'exactly "invoice"']) {
    ok(`states ${needle}`, text.includes(needle))
  }
  ok('optional fields are marked', /total \(optional\)/.test(text))
  ok('required fields are not marked optional', /\bid: string/.test(text))
}

// --- shapes ----------------------------------------------------------------
{
  const nested = describeSchema({
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array', items: {
          type: 'object', required: ['sku'], additionalProperties: false,
          properties: { sku: { type: 'string' }, qty: { type: 'integer', minimum: 1 } },
        },
      },
    },
  })
  ok('an array of objects lists the item fields', /each item is an object:/.test(nested) && /sku: string/.test(nested))
  ok('the item label is not repeated', !/\bitem: object/.test(nested))

  const scalars = describeSchema({ type: 'object', properties: { to: { type: 'array', items: { type: 'string', format: 'email' } } } })
  ok('an array of scalars reads on one line', /array.* of string, email format/.test(scalars))

  const ref = describeSchema({
    $defs: { money: { type: 'number', multipleOf: 0.01 } },
    type: 'object', required: ['paid'], properties: { paid: { $ref: '#/$defs/money' } },
  })
  ok('a local $ref is resolved', /paid: number, rounded to 2 decimal places/.test(ref))

  // Measured: "a multiple of 0.01" is not acted on reliably, "rounded to 2
  // decimal places" is, and that phrase was most of the gap against a careful
  // description written by a person. A step that is not a power of ten has no
  // better phrasing, so it keeps the literal one.
  ok('a non-decimal step keeps the literal wording',
    /a multiple of 0.25/.test(describeSchema({ type: 'number', multipleOf: 0.25 })))

  const union = describeSchema({ type: 'object', properties: { v: { anyOf: [{ type: 'string' }, { type: 'number' }] } } })
  ok('alternatives are spelled out', /one of the following shapes/.test(union) && /option 1/.test(union) && /option 2/.test(union))

  const all = describeSchema({
    allOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      { type: 'object', properties: { b: { type: 'number' } } }],
  })
  ok('allOf is merged into one shape', /a: string/.test(all) && /b \(optional\): number/.test(all))
}

// --- edges -----------------------------------------------------------------
{
  ok('a true schema allows anything', describeSchema(true) === 'output: any')
  ok('a false schema says nothing passes', /nothing is allowed/.test(describeSchema(false)))
  ok('the top level can be renamed', describeSchema({ type: 'string' }, { name: 'answer' }) === 'answer: string')
  const deep = (n) => (n === 0 ? { type: 'string' } : { type: 'object', properties: { x: deep(n - 1) } })
  ok('deep nesting terminates', typeof describeSchema(deep(40)) === 'string')
}

console.log(`describe schema: ${checks} checks passed`)
