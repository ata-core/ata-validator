'use strict'

// `propertyNames: { $ref: '#/definitions/Key' }` and `propertyNames: { type:
// 'string', ... }` sent a schema to the interpreted engine, and Uniswap's
// token-list schema, which uses both, could not be compiled ahead of time. A
// local reference is now replaced by what it names, through aliases, and
// `type: 'string'` is dropped since every property name is a string. What is
// left must be keywords the generators express; anything else still declines.
// Any other subschema is applied to each key as a value. Every shape must
// answer as the interpreted engine does, errors and their paths included.

const assert = require('assert')
const { Validator } = require('..')

const Key = { type: 'string', description: 'a key', minLength: 2, maxLength: 5, pattern: '^[a-z]+$', examples: ['ab'] }
const compiles = {
  ref: { definitions: { Key }, type: 'object', propertyNames: { $ref: '#/definitions/Key' } },
  alias: { $defs: { K: { $ref: '#/$defs/Key' }, Key }, type: 'object', propertyNames: { $ref: '#/$defs/K' } },
  typeString: { type: 'object', propertyNames: { type: 'string', maxLength: 3 } },
  typeList: { type: 'object', propertyNames: { type: ['string', 'null'], pattern: '^x' } },
  nested: { definitions: { Key }, type: 'object', properties: { m: { type: 'object', propertyNames: { $ref: '#/definitions/Key' }, additionalProperties: { type: 'integer' } } } },
  inDef: { definitions: { Key, Map: { type: 'object', propertyNames: { $ref: '#/definitions/Key' } } }, type: 'array', items: { $ref: '#/definitions/Map' } },
  enumKeys: { definitions: { K: { type: 'string', enum: ['aa', 'bb'] } }, type: 'object', propertyNames: { $ref: '#/definitions/K' } },
  // Not reducible to key checks: each key is checked as a value of its own
  // (tests/test_property_names_subschema.js).
  integerType: { type: 'object', propertyNames: { type: 'integer' } },
  validatingSibling: { definitions: { Key }, type: 'object', propertyNames: { $ref: '#/definitions/Key', minLength: 4 } },
  format: { definitions: { K: { type: 'string', format: 'email' } }, type: 'object', propertyNames: { $ref: '#/definitions/K' } },
}
const declines = {
  loop: { definitions: { A: { $ref: '#/definitions/B' }, B: { $ref: '#/definitions/A' } }, type: 'object', propertyNames: { $ref: '#/definitions/A' } },
}
const docs = [
  {}, { ab: 1 }, { a: 1 }, { abcdef: 1 }, { Ab: 1 }, { ab: 1, cd: 2, x: 3 }, { xy: 1 }, { aa: 1, bb: 2 }, { aa: 1, cc: 2 },
  { m: { ab: 1, cd: 'x' } }, { m: { A: 1 } }, [{ ab: 1 }, { a: 1 }], [], 'str', null,
]
const shape = (r) => JSON.stringify(r.valid ? true : r.errors.map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message, e.params]))

let compared = 0
for (const [name, schema] of Object.entries(compiles)) {
  const fast = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  fast.validate({})
  assert.strictEqual(fast.engine(), 'codegen', `${name} should compile`)
  for (const d of docs) {
    assert.strictEqual(shape(fast.validate(structuredClone(d))), shape(interp.validate(structuredClone(d))), `${name} on ${JSON.stringify(d)}`)
    assert.strictEqual(fast.isValidObject(structuredClone(d)), interp.isValidObject(structuredClone(d)), `${name} verdict on ${JSON.stringify(d)}`)
    compared++
  }
}
for (const [name, schema] of Object.entries(declines)) {
  const v = new Validator(schema)
  v.validate({})
  assert.notStrictEqual(v.engine(), 'codegen', `${name} should stay off the generator`)
  const interp = new Validator(schema, { engine: 'interpreter' })
  for (const d of docs) assert.strictEqual(shape(v.validate(structuredClone(d))), shape(interp.validate(structuredClone(d))), `${name} on ${JSON.stringify(d)}`)
}
// The caller's schema is not changed by the rewrite.
const before = JSON.stringify(compiles.ref)
new Validator(compiles.ref).validate({ a: 1 })
assert.strictEqual(JSON.stringify(compiles.ref), before)

console.log(`ok: propertyNames through $ref and with type string compile and agree with the interpreted engine (${compared} documents over ${Object.keys(compiles).length} shapes, ${Object.keys(declines).length} declined)`)
