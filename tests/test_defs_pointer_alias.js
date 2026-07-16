'use strict'

// walkJsonPointer must treat "definitions" and "$defs" as interchangeable
// segments. normalizeDraft7 renames definitions->"$defs" in stored schemas,
// but $ref strings in other schemas that point via #/definitions/... are not
// rewritten. The pointer walker must retry with the alternate key so that
// cross-schema refs authored either way resolve correctly.
//
// Silent-pass bug: invalid email returned { valid: true } because the
// walkJsonPointer returned null for the /definitions/ segment (the key was
// renamed to $defs at normalisation time), causing genCode to emit an empty
// block instead of a format check.

const assert = require('assert')
const { Validator } = require('..')

// (a) Cross-schema: external schema has `definitions.inner` (email format).
//     Second schema references it via #/definitions/inner.
//     Invalid email MUST be rejected -- the silent-pass bug.
{
  const assetSchema = {
    $id: 'http://test.local/asset.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    definitions: {
      inner: { $id: '#innerId', type: 'string', format: 'email' },
    },
    properties: {
      name: { type: 'string' },
    },
  }

  const pointSchema = {
    $id: 'http://test.local/point.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      email: { $ref: 'http://test.local/asset.json#/definitions/inner' },
    },
  }

  const rootSchema = {
    $id: 'http://test.local/root.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'array',
    items: { $ref: 'http://test.local/asset.json#' },
  }

  const v = new Validator(rootSchema, { schemas: { 'http://test.local/asset.json': assetSchema, 'http://test.local/point.json': pointSchema } })

  // valid data passes
  const good = v.validate([{ name: 'test' }])
  assert.strictEqual(good.valid, true, `valid data rejected: ${JSON.stringify(good.errors)}`)

  // invalid email must be rejected
  const nestedV = new Validator(pointSchema, { schemas: { 'http://test.local/asset.json': assetSchema } })
  const bad = nestedV.validate({ email: 'not-an-email' })
  assert.strictEqual(bad.valid, false, 'invalid email silently passed (definitions/$defs pointer alias bug)')
}

// (b) Mirror direction: schema authored with $defs but referenced via #/definitions/
{
  const hostSchema = {
    $id: 'http://test.local/host.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    $defs: {
      myString: { type: 'string', minLength: 3 },
    },
    properties: {
      name: { $ref: '#/$defs/myString' },
    },
  }

  const consumerSchema = {
    $id: 'http://test.local/consumer.json',
    type: 'object',
    properties: {
      name: { $ref: 'http://test.local/host.json#/definitions/myString' },
    },
  }

  const v = new Validator(consumerSchema, { schemas: { 'http://test.local/host.json': hostSchema } })
  const good = v.validate({ name: 'abc' })
  assert.strictEqual(good.valid, true, `valid data rejected (mirror direction): ${JSON.stringify(good.errors)}`)

  const bad = v.validate({ name: 'ab' })
  assert.strictEqual(bad.valid, false, 'too-short string passed via #/definitions/ -> $defs alias (mirror direction)')
}

// (c) Control: plain local #/definitions/x within a single schema still works
{
  const schema = {
    $id: 'http://test.local/local.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    definitions: {
      tag: { type: 'string', enum: ['a', 'b', 'c'] },
    },
    properties: {
      tag: { $ref: '#/definitions/tag' },
    },
  }

  const v = new Validator(schema)
  const good = v.validate({ tag: 'a' })
  assert.strictEqual(good.valid, true, `valid enum value rejected: ${JSON.stringify(good.errors)}`)

  const bad = v.validate({ tag: 'z' })
  assert.strictEqual(bad.valid, false, 'invalid enum value accepted in local #/definitions ref')
}

console.log('ok: definitions/$defs pointer alias resolves in the codegen path')
