'use strict'

// Caller-provided schema objects must not be mutated during compilation.
// normalizeDraft7 renames `definitions` to `$defs` (and rewrites other
// draft-07 keywords) in-place. When that runs against an object the caller
// owns (external schemas passed via `schemas` option or `addSchema`, and the
// root schema itself), it corrupts the caller's view. Real-world impact:
// Fastify hands the same objects to fast-json-stringify *after* giving them
// to the validator; the renamed key makes the serializer throw.

const assert = require('assert')
const { Validator } = require('..')

// Shared fixture used across all cases.
function makeAsset () {
  return {
    $id: 'http://t/asset.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { id: { type: 'string' } },
    definitions: {
      inner: { $id: '#innerId', type: 'string', format: 'email' },
    },
  }
}

// (a) External schema passed via `schemas` option must not be mutated.
{
  const asset = makeAsset()
  const before = JSON.stringify(asset)

  const v = new Validator(
    { type: 'array', items: { $ref: 'http://t/asset.json#' } },
    { schemas: [asset] }
  )
  v.validate([{ id: 'x' }])

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(asset)),
    JSON.parse(before),
    '(a) external schema via schemas[] was mutated during compile+validate'
  )
}

// (b) External schema passed via addSchema() must not be mutated.
{
  const asset = makeAsset()
  const before = JSON.stringify(asset)

  const v = new Validator(
    { type: 'array', items: { $ref: 'http://t/asset.json#' } }
  )
  v.addSchema(asset)
  v.validate([{ id: 'x' }])

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(asset)),
    JSON.parse(before),
    '(b) external schema via addSchema() was mutated during compile+validate'
  )
}

// (c) Root schema with definitions+anchor must not be mutated.
{
  const root = {
    $id: 'http://t/root.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { email: { $ref: '#/definitions/inner' } },
    definitions: {
      inner: { $id: '#innerId', type: 'string', format: 'email' },
    },
  }
  const before = JSON.stringify(root)

  const v = new Validator(root)
  v.validate({ email: 'user@example.com' })

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(root)),
    JSON.parse(before),
    '(c) root schema was mutated during construct+validate'
  )
}

// (d) Validation results remain correct after the fix: the email format inside
//     definitions.inner (referenced from another schema) is still enforced.
{
  const asset = makeAsset()

  const v = new Validator(
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        email: { $ref: 'http://t/asset.json#/definitions/inner' },
      },
    },
    { schemas: [asset] }
  )

  const good = v.validate({ email: 'user@example.com' })
  assert.strictEqual(
    good.valid, true,
    `(d) valid email rejected: ${JSON.stringify(good.errors)}`
  )

  const bad = v.validate({ email: 'not-an-email' })
  assert.strictEqual(
    bad.valid, false,
    '(d) invalid email accepted — format check through definitions ref broken'
  )
}

console.log('ok: caller-provided schema objects are not mutated during compilation')
