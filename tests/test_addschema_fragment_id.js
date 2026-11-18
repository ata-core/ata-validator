'use strict'

// addSchema() names a document as the `schemas` option does (issue #121). A
// fragment-only `$id` ("#frag") is an anchor, which normalization turns into
// `$anchor`, not a document identity. addSchema() checked `$id` on the
// caller's object and registered under the normalized copy's, which that fold
// had deleted: the schema went into the registry under `undefined`, and the
// next check threw "Cannot read properties of undefined (reading 'endsWith')"
// from the code generator. It now throws "Schema must have $id", as the
// `schemas` option throws "Schema in schemas option must have $id".

const assert = require('assert')
const { Validator } = require('..')

const root = () => ({ $id: 'urn:root', type: 'object', properties: { x: { $ref: 'urn:root#frag' } } })

for (const bad of [{ $id: '#frag', maxLength: 2 }, { $id: '' }, { $id: 5 }, {}, null]) {
  const v = new Validator(root())
  assert.throws(() => v.addSchema(bad), /^Error: Schema must have \$id$/, `addSchema(${JSON.stringify(bad)}) refuses`)
  assert.deepStrictEqual([...(v._schemaMap || new Map()).keys()].filter((k) => typeof k !== 'string'), [], 'nothing registered under a non-string key')
  // The validator stays usable: the reference is unresolved, as without the call.
  assert.doesNotThrow(() => v.validate({ x: 'ab' }))
}

// The same schema through the schemas option is refused the same way.
assert.throws(() => new Validator(root(), { schemas: [{ $id: '#frag', maxLength: 2 }] }), /Schema in schemas option must have \$id/)

// A document with an identity registers and resolves as before.
{
  const v = new Validator({ type: 'object', properties: { x: { $ref: 'urn:x' } } })
  v.addSchema({ $id: 'urn:x', maxLength: 2 })
  assert.strictEqual(v.validate({ x: 'ab' }).valid, true)
  assert.strictEqual(v.validate({ x: 'abc' }).valid, false)
}
{
  const v = new Validator({ $schema: 'http://json-schema.org/draft-07/schema#', properties: { x: { $ref: 'http://e.test/a' } } })
  v.addSchema({ $id: 'http://e.test/a', type: 'string' })
  assert.strictEqual(v.validate({ x: 's' }).valid, true)
  assert.strictEqual(v.validate({ x: 1 }).valid, false)
}

console.log('ok: addSchema() refuses a schema without a document $id, as the schemas option does')
