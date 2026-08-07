'use strict'

// The JSON Schema v1 dialect.
//
// v1 is 2020-12 plus propertyDependencies, minus the bookending requirement for
// $dynamicRef. Bookending is the rule that a $dynamicRef only resolves through
// the dynamic scope when the schema it initially resolves to itself carries a
// $dynamicAnchor of the same name; without it the keyword behaves as $ref.
// v1 removes the requirement, so the dynamic scope is consulted whichever
// schema the reference lands on, and also when it lands on nothing.
//
// That is a behavior difference between two dialects over the same document,
// so what this file checks is the switch: the same schema under v1 and under
// 2020-12 must not agree, and nothing outside $dynamicRef may change.

const assert = require('assert')
const { Validator } = require('..')
const { isV1Dialect } = require('../lib/dialect')

let passed = 0
let failed = 0

function check(name, actual, expected) {
  if (actual === expected) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}: expected ${expected}, got ${actual}`)
  }
}

console.log('\nv1 dialect\n')

// ---------------------------------------------------------------------------
// Dialect detection
// ---------------------------------------------------------------------------

check('suite dialect URI', isV1Dialect({ $schema: 'https://json-schema.org/v1' }), true)
check('dated meta-schema URI', isV1Dialect({ $schema: 'https://json-schema.org/v1/2026' }), true)
check('draft/next URI', isV1Dialect({ $schema: 'https://json-schema.org/draft/next/schema' }), true)
check('empty fragment', isV1Dialect({ $schema: 'https://json-schema.org/v1#' }), true)
check('2020-12 is not v1', isV1Dialect({ $schema: 'https://json-schema.org/draft/2020-12/schema' }), false)
check('draft-07 is not v1', isV1Dialect({ $schema: 'http://json-schema.org/draft-07/schema#' }), false)
check('no $schema is not v1', isV1Dialect({ type: 'string' }), false)
check('non-object', isV1Dialect(true), false)

// ---------------------------------------------------------------------------
// $dynamicRef without bookending
// ---------------------------------------------------------------------------

// The reference sits in the `list` resource, which declares no anchor named
// `items`. Under v1 it resolves to the `items` anchor in the outermost scope
// still open, which is `$defs/foo` in the root resource, so the array elements
// must be strings.
function typicalResolution($schema) {
  return {
    $schema,
    $id: 'https://test.json-schema.org/typical-dynamic-resolution/root',
    $ref: 'list',
    $defs: {
      foo: { $dynamicAnchor: 'items', type: 'string' },
      list: {
        $id: 'list',
        type: 'array',
        items: { $dynamicRef: '#items' },
      },
    },
  }
}

const v1Typical = new Validator(typicalResolution('https://json-schema.org/v1'))
check('v1: array of strings is valid', v1Typical.validate(['foo', 'bar']).valid, true)
check('v1: array with a number is invalid', v1Typical.validate(['foo', 42]).valid, false)

// The same document under 2020-12. Bookending applies, the reference resolves
// to nothing, and the data is not accepted. The point of the assertion is that
// the two dialects disagree over one document, which is what makes the
// detection load-bearing rather than decorative.
//
// This is asserted against the interpreted engine directly rather than through
// Validator, because the native engine does not implement bookending: it
// resolves this document the v1 way under either dialect. That divergence is
// invisible to the official 2020-12 suite, which only covers references that
// resolve to a schema carrying no matching anchor, never one that resolves to
// nothing, and it is why a v1 schema using $dynamicRef is routed to the
// interpreter rather than to the addon.
const { createInterpreter } = require('../lib/interpreter')
const doc = typicalResolution('https://json-schema.org/draft/2020-12/schema')
check('2020-12: bookending rejects what v1 accepts', createInterpreter(doc, {}).validate(['foo', 'bar']).valid, false)
check('v1 flag on the same document accepts it', createInterpreter(doc, { v1: true }).validate(['foo', 'bar']).valid, true)

// An intermediate resource that declares no matching $dynamicAnchor must not
// interrupt the search: the anchor in the outermost scope still wins.
const v1Intermediate = new Validator({
  $schema: 'https://json-schema.org/v1',
  $id: 'https://test.json-schema.org/dynamic-resolution-with-intermediate-scopes/root',
  $ref: 'intermediate-scope',
  $defs: {
    foo: { $dynamicAnchor: 'items', type: 'string' },
    'intermediate-scope': { $id: 'intermediate-scope', $ref: 'list' },
    list: { $id: 'list', type: 'array', items: { $dynamicRef: '#items' } },
  },
})
check('v1: intermediate scope does not interrupt resolution', v1Intermediate.validate(['foo', 'bar']).valid, true)
check('v1: intermediate scope, number is still invalid', v1Intermediate.validate(['foo', 42]).valid, false)

// A $dynamicRef with no matching anchor anywhere in the dynamic scope still
// behaves as a plain $ref, which here resolves to a string schema.
const v1PlainFallback = new Validator({
  $schema: 'https://json-schema.org/v1',
  $id: 'https://test.json-schema.org/no-matching-anchor/root',
  type: 'array',
  items: { $dynamicRef: '#thing' },
  $defs: { thing: { $anchor: 'thing', type: 'string' } },
})
check('v1: falls back to plain $ref resolution', v1PlainFallback.validate(['a']).valid, true)
check('v1: plain fallback still asserts', v1PlainFallback.validate([1]).valid, false)

// ---------------------------------------------------------------------------
// The gate is narrow
// ---------------------------------------------------------------------------

// Declaring v1 must not move a schema off the compiled path when it uses no
// dynamic references. v1 and 2020-12 agree on everything else ata implements,
// so there is nothing to route away from.
const v1Plain = new Validator({
  $schema: 'https://json-schema.org/v1',
  type: 'object',
  properties: { a: { type: 'string' } },
  required: ['a'],
})
check('v1 without $dynamicRef validates', v1Plain.validate({ a: 'x' }).valid, true)
check('v1 without $dynamicRef rejects', v1Plain.validate({ a: 1 }).valid, false)
check('v1 without $dynamicRef stays compiled', typeof v1Plain._jsFn === 'function', true)

// propertyDependencies is a v1 keyword and must keep working when the dialect
// is stated rather than left implicit.
const v1PropDeps = new Validator({
  $schema: 'https://json-schema.org/v1',
  propertyDependencies: {
    kind: {
      customer: { required: ['accountId'] },
      employee: { required: ['staffId'] },
    },
  },
})
check('v1: propertyDependencies selects by value', v1PropDeps.validate({ kind: 'customer', accountId: 'a' }).valid, true)
check('v1: propertyDependencies rejects the wrong shape', v1PropDeps.validate({ kind: 'customer' }).valid, false)
check('v1: propertyDependencies ignores an unlisted value', v1PropDeps.validate({ kind: 'other' }).valid, true)

console.log(`\n${passed} passed, ${failed} failed\n`)
assert.strictEqual(failed, 0, `${failed} v1 dialect assertions failed`)
