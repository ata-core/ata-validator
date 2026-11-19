'use strict'

// `new Validator(schema)` without options returns the validator already
// built for that schema object once one has compiled, so building it again
// costs a lookup. That validator is compiled, and addSchema() on it throws
// even for a caller that has not validated anything yet (issue #122). The
// refusal says how to get a validator of one's own, and that way works: an
// options object, even {}, or a copy of the schema. The first validator is
// not touched by either.

const assert = require('assert')
const { Validator } = require('..')

const root = { type: 'object', properties: { x: { $ref: 'urn:x' } } }
const first = new Validator(root)
assert.strictEqual(first.validate({ x: 'abc' }).valid, false, 'the reference is unresolved for the first validator')

const shared = new Validator(root)
assert.strictEqual(shared, first, 'without options the same validator comes back')
assert.throws(() => shared.addSchema({ $id: 'urn:x', maxLength: 2 }), /pass options, even \{\}, for a new validator/, 'the refusal says what to do')

for (const make of [() => new Validator(root, {}), () => new Validator(structuredClone(root))]) {
  const own = make()
  assert.notStrictEqual(own, first)
  own.addSchema({ $id: 'urn:x', maxLength: 2 })
  assert.strictEqual(own.validate({ x: 'ab' }).valid, true)
  assert.strictEqual(own.validate({ x: 'abc' }).valid, false)
}
assert.strictEqual(first.validate({ x: 'ab' }).valid, false, 'the first validator keeps its registry')

console.log('ok: addSchema() on a shared compiled validator explains the shared instance, and {} gives a separate one')
