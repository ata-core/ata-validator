'use strict'

// Draft-07 rules that differ from 2020-12 and are applied by normalization,
// so every engine reads them the same way.

const assert = require('assert')
const { Validator } = require('..')

const D7 = 'http://json-schema.org/draft-07/schema#'
let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('draft-07 semantics\n')

check('$ref ignores its sibling keywords', () => {
  const v = new Validator({ $schema: D7, definitions: { arr: { type: 'array' } }, $ref: '#/definitions/arr', maxItems: 1 })
  assert.strictEqual(v.validate([1, 2, 3]).valid, true)
  assert.strictEqual(v.validate('x').valid, false)
})

check('a sibling $id does not change the base URI of a $ref', () => {
  const v = new Validator({
    $schema: D7,
    $id: 'http://localhost:1234/sibling_id/base/',
    definitions: {
      foo: { $id: 'http://localhost:1234/sibling_id/foo.json', type: 'string' },
      base_foo: { $comment: 'this canonical uri is http://localhost:1234/sibling_id/base/foo.json', $id: 'foo.json', type: 'number' },
    },
    allOf: [{ $comment: 'ignored', $id: 'http://localhost:1234/sibling_id/', $ref: 'foo.json' }],
  })
  assert.strictEqual(v.validate(1).valid, true)
  assert.strictEqual(v.validate('a').valid, false)
})

check('a fragment-only $id is a plain-name anchor', () => {
  const v = new Validator({ $schema: D7, definitions: { A: { $id: '#foo', type: 'integer' } }, $ref: '#foo' })
  assert.strictEqual(v.validate(1).valid, true)
  assert.strictEqual(v.validate('a').valid, false)
})

check('a retrieved document without $schema is read under the root draft', () => {
  const v = new Validator(
    { $schema: D7, $ref: 'http://example.com/remote.json#/definitions/refToInteger' },
    { schemas: { 'http://example.com/remote.json': { definitions: { refToInteger: { $ref: '#foo' }, A: { $id: '#foo', type: 'integer' } } } } },
  )
  assert.strictEqual(v.validate(1).valid, true)
  assert.strictEqual(v.validate('a').valid, false)
})

check('a pointer into array-form items still resolves after normalization', () => {
  const v = new Validator({ $schema: D7, items: [{ type: 'integer' }, { $ref: '#/items/0' }] })
  assert.strictEqual(v.validate([1, 2]).valid, true)
  assert.strictEqual(v.validate([1, 'b']).valid, false)
})

check('2020-12 keeps applying $ref siblings', () => {
  const v = new Validator({ $defs: { arr: { type: 'array' } }, $ref: '#/$defs/arr', maxItems: 1 })
  assert.strictEqual(v.validate([1, 2]).valid, false)
})

console.log(`\n${passed} passed`)
