'use strict'

// A `$ref` into another document whose own root carries a fragment-only `$ref`
// used to validate everything.
//
// The combined code generator emits a single pass that both validates and
// collects errors. It did not run the guard the boolean generator runs, so when
// it could not emit a check for the cross-document reference it emitted nothing
// at all and collapsed to `() => VALID_RESULT`. Every constraint behind the
// reference was dropped silently, which is the same failure mode as an
// unresolved `$ref` validating everything.
//
// The reference has to be followed for the constraint to apply, so a document
// that keeps its constraints behind `#/$defs/...` is the case to hold down.
// `npm run test:suite` covers it through `ref.json :: remote ref, containing
// refs itself`; this file states it directly so the intent survives a suite bump.

const assert = require('assert')
const { Validator } = require('../index.js')

const DIALECTS = {
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
  v1: 'https://json-schema.org/v1',
}

function remoteDoc(dialect) {
  return {
    $schema: dialect,
    $id: 'http://localhost:1234/root-ref.json',
    $defs: { inner: { properties: { bar: { type: 'string' } } } },
    $ref: '#/$defs/inner',
  }
}

for (const [label, dialect] of Object.entries(DIALECTS)) {
  const validator = new Validator(
    { $schema: dialect, $ref: 'http://localhost:1234/root-ref.json' },
    { schemas: { 'http://localhost:1234/root-ref.json': remoteDoc(dialect) } },
  )

  assert.strictEqual(
    validator.validate({ bar: '' }).valid,
    true,
    `${label}: a string bar satisfies the schema behind the remote root $ref`,
  )
  assert.strictEqual(
    validator.validate({ bar: 0 }).valid,
    false,
    `${label}: the constraint behind the remote root $ref must still apply`,
  )
}

// The same document reached without the cross-document hop already worked, and
// has to keep working: the fix must bail out of codegen, not disable the path.
{
  const local = new Validator({
    $defs: { inner: { properties: { bar: { type: 'string' } } } },
    $ref: '#/$defs/inner',
  })
  assert.strictEqual(local.validate({ bar: '' }).valid, true, 'local root $ref accepts a string')
  assert.strictEqual(local.validate({ bar: 0 }).valid, false, 'local root $ref rejects a number')
}

// A cross-document reference whose target holds its constraints inline stays on
// the compiled path, so the guard must not be widened into "any cross-doc ref".
{
  const inline = new Validator(
    { $ref: 'http://localhost:1234/inline.json' },
    {
      schemas: {
        'http://localhost:1234/inline.json': {
          $id: 'http://localhost:1234/inline.json',
          properties: { bar: { type: 'string' } },
        },
      },
    },
  )
  assert.strictEqual(inline.validate({ bar: '' }).valid, true, 'inline target accepts a string')
  assert.strictEqual(inline.validate({ bar: 0 }).valid, false, 'inline target rejects a number')
}

console.log('ok: cross-document root $ref keeps its constraints')
