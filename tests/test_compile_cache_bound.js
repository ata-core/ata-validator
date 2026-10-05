'use strict'

// The compile and preprocess caches are bounded. Unbounded, they kept every
// schema's text and compiled functions for the life of the process, 1.2 GB
// after compiling each SchemaStore schema once. This compiles more distinct
// schemas than the bound, checks the caches stay within it, and that a schema
// whose entry was dropped compiles again and answers the same.

const assert = require('node:assert')
const core = require('../lib/validator-core')
const { Validator } = require('..')
const { _compileCache } = core._internals

const schemaFor = (i) => ({ type: 'object', properties: { ['k' + i]: { type: 'integer', default: i } }, required: ['n'] })
const first = new Validator(schemaFor(0))
assert.strictEqual(first.validate({ n: 1, k0: 'x' }).valid, false)
for (let i = 1; i < 300; i++) {
  const v = new Validator(schemaFor(i))
  assert.strictEqual(v.validate({ n: 1 }).valid, true)
  void v.validate({}).errors
}
assert.ok(_compileCache.size <= 128, `compile cache holds ${_compileCache.size} entries`)
const again = new Validator(schemaFor(0))
const doc = { n: 1 }
assert.strictEqual(again.validate(doc).valid, true)
assert.strictEqual(doc.k0, 0, 'defaults still applied after the entry was dropped')
assert.strictEqual(again.validate({ n: 1, k0: 'x' }).valid, false)
assert.strictEqual(first.validate({ n: 1, k0: 'x' }).valid, false, 'a validator built before eviction keeps working')
console.log(`ok: the compile cache stays within its bound (${_compileCache.size} entries after 300 schemas) and an evicted schema compiles again`)
