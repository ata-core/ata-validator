'use strict'

// A value that fails a patternProperties subschema must be reported by that
// subschema's own keyword, at the key's instance path, with the real schema
// pointer. The runtime path used to run the subschema as a boolean and report
// a generic "value invalid for key" error at the parent with a synthetic
// "#/patternProperties" pointer, which no source map could resolve.

process.env.ATA_NO_NATIVE = '1'
const assert = require('assert')
const { Validator } = require('../index.js')

let passed = 0
function check(name, fn) {
  fn()
  console.log(`  PASS  ${name}`)
  passed++
}

console.log('patternProperties error paths\n')

check('subschema keyword reported at the key path', () => {
  const v = new Validator({
    type: 'object',
    properties: { id: { type: 'integer' } },
    patternProperties: { '^x-': { type: 'string' } },
    additionalProperties: false,
  })
  const r = v.validate({ id: 1, 'x-flag': 5 })
  assert.strictEqual(r.valid, false)
  assert.strictEqual(r.errors.length, 1)
  assert.strictEqual(r.errors[0].keyword, 'type')
  assert.strictEqual(r.errors[0].path, '/x-flag')
  assert.strictEqual(r.errors[0].schemaPath, '#/patternProperties/^x-/type')
  assert.strictEqual(v.validate({ id: 1, 'x-flag': 'on' }).valid, true)
})

check('same without additionalProperties', () => {
  const v = new Validator({ type: 'object', patternProperties: { '^n': { type: 'number', minimum: 0 } } })
  const r = v.validate({ n1: -1, other: 'free' })
  assert.strictEqual(r.valid, false)
  assert.strictEqual(r.errors[0].keyword, 'minimum')
  assert.strictEqual(r.errors[0].path, '/n1')
  assert.strictEqual(r.errors[0].schemaPath, '#/patternProperties/^n/minimum')
})

check('pattern containing / and quote yields a valid pointer and valid code', () => {
  const v = new Validator({
    type: 'object',
    patternProperties: { '^https?://': { type: 'integer' }, "^it's": { type: 'boolean' } },
  })
  const r = v.validate({ 'http://x': 'no', "it's": 1 })
  assert.strictEqual(r.valid, false)
  const paths = r.errors.map((e) => e.schemaPath).sort()
  assert.deepStrictEqual(paths, ["#/patternProperties/^https?:~1~1/type", "#/patternProperties/^it's/type"])
})

console.log(`\n${passed} passed`)
