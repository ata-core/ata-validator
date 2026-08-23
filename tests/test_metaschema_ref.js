'use strict'

// A $ref to a dialect's meta-schema resolves from the vendored copies, with
// no registry and no network. The 2020-12 meta-schema is eight documents tied
// together with $dynamicRef, so it exercises the cross-document dynamic scope
// path; the code generator must decline it and the interpreter must answer.

const assert = require('assert')
const { Validator } = require('..')

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('meta-schema references\n')

check('2020-12: a schema validates against its meta-schema', () => {
  const v = new Validator({ $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'https://json-schema.org/draft/2020-12/schema' })
  assert.strictEqual(v.validate({ $defs: { foo: { type: 'integer' } } }).valid, true)
  assert.strictEqual(v.validate({ $defs: { foo: { type: 1 } } }).valid, false)
  assert.strictEqual(v.validate({ type: 'object', properties: { a: { minimum: 'x' } } }).valid, false)
  assert.strictEqual(v.validate({ $id: 'not a uri with spaces' }).valid, false)
})

check('draft-07: a schema validates against its meta-schema', () => {
  const v = new Validator({ $schema: 'http://json-schema.org/draft-07/schema#', $ref: 'http://json-schema.org/draft-07/schema#' })
  assert.strictEqual(v.validate({ definitions: { foo: { type: 'integer' } } }).valid, true)
  assert.strictEqual(v.validate({ definitions: { foo: { type: 1 } } }).valid, false)
})

check('the spelling of the meta-schema URI does not matter', () => {
  for (const ref of ['https://json-schema.org/draft/2020-12/schema#', 'http://json-schema.org/draft/2020-12/schema', 'http://json-schema.org/draft-07/schema']) {
    const v = new Validator({ $ref: ref })
    assert.strictEqual(v.validate({ type: 1 }).valid, false, ref)
    assert.strictEqual(v.validate({ type: 'string' }).valid, true, ref)
  }
})

check('a caller-supplied copy wins over the vendored one', () => {
  const v = new Validator({ $ref: 'https://json-schema.org/draft/2020-12/schema' }, { schemas: { 'https://json-schema.org/draft/2020-12/schema': { type: 'string' } } })
  assert.strictEqual(v.validate('x').valid, true)
  assert.strictEqual(v.validate({}).valid, false)
})

console.log(`\n${passed} passed`)
