'use strict'

// engine() reports which engine answers validate(). It exists so a startup
// log or a benchmark can say which path a schema took, and so a change that
// pushes common shapes off the generated path shows up as a failing test.

const assert = require('assert')
const { Validator } = require('..')

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('engine diagnostic\n')

const shared = { $id: 'shared', type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }

check('typical request schemas take the generated path', () => {
  const shapes = [
    { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, age: { type: 'integer', minimum: 13 } }, additionalProperties: false },
    { type: 'object', properties: { page: { type: 'integer', minimum: 1, default: 1 }, sort: { enum: ['asc', 'desc'] } } },
    { type: 'array', items: { type: 'object', required: ['sku'], properties: { sku: { type: 'string', pattern: '^[A-Z0-9-]+$' } } }, minItems: 1 },
    { $ref: 'shared#' },
    { oneOf: [{ type: 'object', required: ['a'], properties: { a: { type: 'integer' } } }, { type: 'object', required: ['b'], properties: { b: { type: 'string' } } }] },
    { type: 'object', properties: { type: { enum: ['card', 'bank'] }, iban: { type: 'string' } }, if: { properties: { type: { const: 'bank' } } }, then: { required: ['iban'] } },
    { $defs: { addr: { type: 'object', properties: { zip: { type: 'string' } } } }, type: 'object', properties: { home: { $ref: '#/$defs/addr' } } },
  ]
  for (const s of shapes) assert.strictEqual(new Validator(s, { schemas: [shared] }).engine(), 'codegen', JSON.stringify(s))
})

check('shapes the generator declines report the engine that answers', () => {
  const v = new Validator({ type: 'object', patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false })
  assert.ok(['interpreter', 'closure', 'native'].includes(v.engine()))
  assert.strictEqual(v.validate({ 'x-a': 'ok' }).valid, true)
  assert.strictEqual(v.validate({ 'x-a': 1 }).valid, false)
})

check('the type is one of four names', () => {
  const names = new Set(['codegen', 'closure', 'native', 'interpreter'])
  assert.ok(names.has(new Validator(true).engine()))
  assert.ok(names.has(new Validator({ $dynamicAnchor: 'n', type: 'object', properties: { c: { $dynamicRef: '#n' } } }).engine()))
})

console.log(`\n${passed} passed`)
