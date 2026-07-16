'use strict'

// Caller-provided schema objects must not be mutated during compilation.
// normalizeDraft7 renames `definitions` to `$defs` (and rewrites other
// draft-07 keywords) in-place. When that runs against an object the caller
// owns (external schemas passed via `schemas` option or `addSchema`, and the
// root schema itself), it corrupts the caller's view. Real-world impact:
// Fastify hands the same objects to fast-json-stringify *after* giving them
// to the validator; the renamed key makes the serializer throw.

const assert = require('assert')
const { Validator, validateAsync } = require('..')
const { t } = require('../t.js')

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

// (e) Refined schema with a nullable field: normalization clones the schema,
//     but the clone must preserve the Symbol-keyed refinement so that
//     validateAsync(validatorInstance, data) still enforces it.
//     The nullable field forces _normalizeCallerSchema to produce a clone
//     (nullable gets rewritten to type array), so this directly exercises the
//     symbol-stripping bug.
;(async () => {
  const S = t.refine(
    t.object({ n: t.integer({ nullable: true }) }),
    async (v) => v.n >= 0,
    { message: 'n must be non-negative', path: '/n' }
  )

  const v = new Validator(S)

  // The stored _schemaObj must be a clone (normalization changed nullable).
  assert.notStrictEqual(
    v._schemaObj, S,
    '(e) _schemaObj should be a clone when normalization changes the schema'
  )

  // n=-1 is structurally valid (integer, nullable covered) but fails the
  // refinement. With the bug the refinement is silently skipped and the
  // result is valid=true. After the fix it must be invalid.
  const bad = await validateAsync(v, { n: -1 })
  assert.strictEqual(
    bad.valid, false,
    `(e) refinement skipped after normalization: n=-1 must be invalid but got valid=${bad.valid}`
  )
  assert.ok(
    bad.errors && bad.errors.some((e) => e.message === 'n must be non-negative'),
    `(e) expected refinement error message, got: ${JSON.stringify(bad.errors)}`
  )

  // n=5 satisfies both the structure and the refinement.
  const good = await validateAsync(v, { n: 5 })
  assert.strictEqual(
    good.valid, true,
    `(e) n=5 must be valid, got: ${JSON.stringify(good.errors)}`
  )

  console.log('ok (e): refinement symbol survives normalization clone')
})().catch((e) => { console.error(e); process.exit(1) })

// (f) OPTIONAL symbol survives normalization: a t.optional field in a schema
//     that triggers normalization must still be treated as optional after
//     construction (missing property validates).
;(async () => {
  // The nullable on the sibling field forces normalization to clone the schema.
  const S = t.object({
    n: t.integer({ nullable: true }),
    x: t.optional(t.string()),
  })

  const v = new Validator(S)

  // x is optional — omitting it must be valid.
  const withoutX = v.validate({ n: 1 })
  assert.strictEqual(
    withoutX.valid, true,
    `(f) omitting optional x must be valid, got: ${JSON.stringify(withoutX.errors)}`
  )

  // x present is also valid.
  const withX = v.validate({ n: 1, x: 'hello' })
  assert.strictEqual(
    withX.valid, true,
    `(f) x present must be valid, got: ${JSON.stringify(withX.errors)}`
  )

  console.log('ok (f): OPTIONAL symbol survives normalization clone')
})().catch((e) => { console.error(e); process.exit(1) })

console.log('ok: caller-provided schema objects are not mutated during compilation')
