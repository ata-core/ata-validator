'use strict'

// Standard JSON Schema: `~standard.jsonSchema.input({ target })` hands back the
// schema a validator checks, for consumers that publish it, the MCP SDK's
// `inputSchema` and `outputSchema` among them. ata validates the JSON Schema it
// was given and does not convert between dialects, so a target that is not
// the schema's dialect throws instead of returning a document that would mean
// something else there. The dialect is the one the schema declares; no
// `$schema` means 2020-12, as ata reads it.

const assert = require('assert')
const { Validator } = require('..')

const D7 = 'http://json-schema.org/draft-07/schema#'
const D2020 = 'https://json-schema.org/draft/2020-12/schema'
let passed = 0
function check (name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('standard json schema\n')

check('a schema without $schema is a 2020-12 schema, as ata reads it', () => {
  const schema = { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'] }
  const std = new Validator(schema)['~standard']
  assert.deepStrictEqual(std.jsonSchema.input({ target: 'draft-2020-12' }), schema)
  assert.deepStrictEqual(std.jsonSchema.output({ target: 'draft-2020-12' }), schema)
  assert.throws(() => std.jsonSchema.input({ target: 'draft-07' }), TypeError, 'draft-07 needs the schema to say so')
})

check('the result is a copy: changing it changes neither the schema nor the validator', () => {
  const schema = { type: 'object', properties: { n: { type: 'integer' } } }
  const v = new Validator(schema)
  const out = v['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
  out.properties.n.type = 'string'
  assert.strictEqual(schema.properties.n.type, 'integer')
  assert.strictEqual(v.validate({ n: 1 }).valid, true)
})

check('a target that is not the schema dialect throws', () => {
  const d7 = new Validator({ $schema: D7, type: 'object', definitions: { a: { type: 'string' } } })['~standard'].jsonSchema
  assert.deepStrictEqual(d7.input({ target: 'draft-07' }).definitions, { a: { type: 'string' } })
  assert.throws(() => d7.input({ target: 'draft-2020-12' }), TypeError)
  const d2020 = new Validator({ $schema: D2020, type: 'array', prefixItems: [{ type: 'string' }] })['~standard'].jsonSchema
  assert.ok(d2020.input({ target: 'draft-2020-12' }).prefixItems)
  assert.throws(() => d2020.input({ target: 'draft-07' }), TypeError)
  const bare2020 = new Validator({ type: 'object', $defs: { a: { type: 'string' } }, properties: { x: { $ref: '#/$defs/a' } } })['~standard'].jsonSchema
  for (const target of ['openapi-3.0', 'draft-04', 'draft-07', undefined]) {
    assert.throws(() => bare2020.input({ target }), TypeError, String(target))
  }
})

check('boolean schemas', () => {
  assert.deepStrictEqual(new Validator(true)['~standard'].jsonSchema.input({ target: 'draft-2020-12' }), {})
  assert.deepStrictEqual(new Validator(false)['~standard'].jsonSchema.input({ target: 'draft-2020-12' }), { not: {} })
})

check('validation through ~standard is unchanged', () => {
  const std = new Validator({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] })['~standard']
  assert.deepStrictEqual(std.validate({ n: 1 }), { value: { n: 1 } })
  assert.strictEqual(std.validate({}).issues.length, 1)
})

console.log(`\n${passed} passed`)
