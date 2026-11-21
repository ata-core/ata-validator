'use strict'

// lib/buffer-gate.js decides per schema whether the buffer APIs may answer
// from the native walker. Typical request schemas must stay on it; the shapes
// the walker gets wrong must go through validate(). When routed, every buffer
// entry point must behave like the native one, including NDJSON line rules.

const assert = require('assert')
const { bufferNeedsSlowPath, installSlowBufferApis } = require('../lib/buffer-gate')
const { Validator } = require('..')

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('buffer gate\n')

check('a typical request schema stays on the native walker', () => {
  const s = {
    type: 'object',
    required: ['id', 'email'],
    properties: {
      id: { type: 'integer', minimum: 1 },
      email: { type: 'string', format: 'email', maxLength: 120 },
      tags: { type: 'array', items: { type: 'string', pattern: '^[a-z-]+$' }, maxItems: 10 },
      role: { enum: ['admin', 'user'] },
      address: { $ref: '#/$defs/addr' },
    },
    additionalProperties: false,
    $defs: { addr: { type: 'object', properties: { zip: { type: 'string' } } } },
  }
  assert.strictEqual(bufferNeedsSlowPath(s, new Map()), false)
})

check('shapes the walker gets wrong are routed', () => {
  const routed = [
    true,
    { enum: [] },
    { type: 'array', contains: { type: 'integer' } },
    { properties: { a: {} }, unevaluatedProperties: false },
    { patternProperties: { '^x-': { type: 'string' } } },
    { propertyNames: { maxLength: 3 } },
    { dependentRequired: { a: ['b'] } },
    { properties: { p: { dependentSchemas: { a: { required: ['b'] } } } } },
    { $ref: 'http://example.com/other.json' },
    { $defs: { inner: { $id: 'http://example.com/inner', type: 'integer' } } },
    { format: 'date-time' },
    { pattern: '^\\p{L}+$' },
    { prefixItems: [{ type: 'integer' }] },
    { items: [{ type: 'integer' }] },
    { allOf: [{ items: false }] },
    // A count bound that is not a whole number from zero: the walker skips it.
    { minLength: 1.5 }, { maxLength: -1 }, { properties: { a: { minItems: 0.5 } } }, { maxItems: -1 },
    { minProperties: 2.5 }, { maxProperties: -1 }, { items: { maxLength: '2' } },
  ]
  for (const s of routed) assert.strictEqual(bufferNeedsSlowPath(s, new Map()), true, JSON.stringify(s))
  for (const s of [{ minLength: 1 }, { maxLength: 2.0 }, { minItems: 0 }, { maxProperties: 3 }]) assert.strictEqual(bufferNeedsSlowPath(s, new Map()), false, JSON.stringify(s))
})

check('a count bound the walker skips gives the validate() verdict on every buffer API', () => {
  const cases = [
    [{ type: 'string', minLength: 1.5 }, '"a"'], [{ type: 'string', maxLength: -1 }, '""'],
    [{ type: 'array', minItems: 1.5 }, '[1]'], [{ type: 'array', maxItems: -1 }, '[]'],
    [{ type: 'object', minProperties: 0.5 }, '{}'], [{ type: 'object', maxProperties: -1 }, '{}'],
  ]
  for (const [s, text] of cases) {
    const v = new Validator(s, {})
    const want = v.validate(JSON.parse(text)).valid
    assert.strictEqual(want, false, JSON.stringify(s))
    assert.strictEqual(v.isValid(Buffer.from(text)), want, `isValid ${JSON.stringify(s)}`)
    assert.strictEqual(v.countValid(Buffer.from(text + '\n' + text)), 0, `countValid ${JSON.stringify(s)}`)
    assert.strictEqual(v.isValidJSON(text + ' '.repeat(9000)), want, `isValidJSON past the native threshold ${JSON.stringify(s)}`)
  }
})

check('an external schema with a routed shape routes the validator', () => {
  const map = new Map([['http://example.com/x', { contains: { type: 'string' } }]])
  assert.strictEqual(bufferNeedsSlowPath({ type: 'object' }, map), true)
})

check('routed APIs give the validate() verdict', () => {
  const v = new Validator({ type: 'array', contains: { type: 'integer' }, minContains: 2 })
  // Works with or without the native addon: the slow APIs only need validate().
  installSlowBufferApis(v)
  assert.strictEqual(v.isValid(Buffer.from('[1, 2, "x"]')), true)
  assert.strictEqual(v.isValid('[1, "x"]'), false)
  assert.strictEqual(v.isValid(Buffer.from('not json')), false)
  assert.strictEqual(v.isValidJSON('[3, 4]'), true)
  assert.throws(() => v.isValid({}), TypeError)
  const ndjson = Buffer.from('[1,2]\n\n[1]\n[5,6,7]')
  assert.deepStrictEqual(v.isValidNDJSON(ndjson), [true, false, true])
  assert.strictEqual(v.countValid(ndjson), 2)
  assert.deepStrictEqual(v.isValidParallel(ndjson), [true, false, true])
  assert.strictEqual(v.batchIsValid([Buffer.from('[1,2]'), Buffer.from('[]')]), 1)
  assert.throws(() => v.batchIsValid(['[1,2]']), TypeError)
  const padded = Buffer.alloc(64)
  padded.write('[7,8]')
  assert.strictEqual(v.isValidPrepadded(padded, 5), true)
})

console.log(`\n${passed} passed`)
