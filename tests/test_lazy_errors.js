'use strict'

// validate() answers the verdict first and materializes `errors` on first
// access. The presentation pipeline (declaration order, enrichment, custom
// messages) is unchanged in output; only when it runs moved. This holds the
// observable contract down.

const assert = require('assert')
const { Validator } = require('..')

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('lazy error materialization\n')

check('the result shape is unchanged, errors cached on first read', () => {
  const v = new Validator({ type: 'object', required: ['id'], properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' } } })
  const ok = v.validate({ id: 1 })
  assert.strictEqual(ok.valid, true)
  assert.deepStrictEqual([...ok.errors], [])
  const bad = v.validate({ id: 'x', email: 'nope' })
  assert.strictEqual(bad.valid, false)
  const first = bad.errors
  assert.strictEqual(bad.errors, first, 'errors must be cached')
  assert.ok(first.length >= 2)
  assert.strictEqual(first[0].code, 'ATA1001')
  assert.ok('received' in first[0], 'enrichment still applies')
  assert.ok(JSON.stringify(bad).includes('"errors"'), 'stringify sees errors')
})

check('declaration order still holds', () => {
  const v = new Validator({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } } })
  const r = v.validate({ b: 'x', a: 1 })
  assert.deepStrictEqual(r.errors.map((e) => e.path), ['/a', '/b'])
})

check('interpreter-routed schemas are lazy too', () => {
  const v = new Validator({ type: 'object', patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false })
  const r = v.validate({ 'x-a': 1, other: 2 })
  assert.strictEqual(r.valid, false)
  assert.deepStrictEqual(r.errors.map((e) => e.code).sort(), ['ATA1001', 'ATA4005'])
})

check('errorMessage overrides still apply', () => {
  const v = new Validator({ type: 'object', required: ['name'], properties: { name: { type: 'string' } }, errorMessage: { required: { name: 'name is mandatory' } } })
  const r = v.validate({})
  assert.strictEqual(r.errors[0].message, 'name is mandatory')
})

check('abortEarly keeps the shared frozen stub', () => {
  const v = new Validator({ type: 'object', required: ['a'] }, { abortEarly: true })
  const r1 = v.validate({})
  const r2 = v.validate({})
  assert.strictEqual(r1, r2, 'shared result object')
  assert.strictEqual(r1.errors[0].code, 'ATA9000')
})

check('coercion schemas still see preprocessed data', () => {
  const v = new Validator({ type: 'object', properties: { n: { type: 'integer' } } }, { coerceTypes: true })
  const data = { n: '5' }
  const r = v.validate(data)
  assert.strictEqual(r.valid, true)
  assert.strictEqual(data.n, 5)
})

check('~standard reads errors through the getter', () => {
  const v = new Validator({ type: 'object', required: ['id'], properties: { id: { type: 'integer' } } })
  const out = v['~standard'].validate({ id: 'x' })
  assert.ok(Array.isArray(out.issues) && out.issues.length === 1)
})

console.log(`\n${passed} passed`)
