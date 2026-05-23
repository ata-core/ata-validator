'use strict'

const { Validator } = require('..')
const assert = require('assert')

function test(name, fn) {
  try { fn(); console.log('  PASS:', name) }
  catch (err) { console.log('  FAIL:', name); console.log('        ', err.message); process.exitCode = 1 }
}

console.log('\n=== nullable keyword (OpenAPI) ===')

test('nullable: true allows null on a typed property', () => {
  const v = new Validator({ type: 'object', properties: { hello: { type: 'string', format: 'email', nullable: true } } })
  assert.strictEqual(v.validate({ hello: null }).valid, true)
  assert.strictEqual(v.validate({ hello: 'a@b.com' }).valid, true)
})

test('nullable: true still rejects a wrong non-null type', () => {
  const v = new Validator({ type: 'object', properties: { n: { type: 'number', nullable: true } } })
  assert.strictEqual(v.validate({ n: null }).valid, true)
  assert.strictEqual(v.validate({ n: 5 }).valid, true)
  assert.strictEqual(v.validate({ n: 'x' }).valid, false)
})

test('without nullable, null is rejected for a typed property', () => {
  const v = new Validator({ type: 'object', properties: { s: { type: 'string' } } })
  assert.strictEqual(v.validate({ s: null }).valid, false)
})

test('nullable on a root object schema allows null', () => {
  const v = new Validator({ type: 'object', nullable: true, properties: { hello: { type: 'string' } } })
  assert.strictEqual(v.validate(null).valid, true)
  assert.strictEqual(v.validate({ hello: 'x' }).valid, true)
})

test('nullable does not corrupt a default value that contains the key', () => {
  const v = new Validator({ type: 'object', properties: { cfg: { type: 'object', default: { nullable: true } } } })
  const data = {}
  v.validate(data)
  assert.deepStrictEqual(data.cfg, { nullable: true })
})

console.log('\ndone.\n')
