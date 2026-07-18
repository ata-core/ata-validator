'use strict'

// Codegen-bail schemas must land on an engine that gets them right. Three
// historical wrong turns, all caught by the official draft 2020-12 suite:
//
//  1. codegen compiled unevaluatedItems alongside contains but never credited
//     contains-matched items as evaluated, so valid arrays were rejected.
//  2. the $anchor exemption let codegen compile schemas whose anchors live in
//     different $id base-URI scopes; the flat anchor map picked the wrong one.
//  3. with the native addon present, bail schemas went to the C++ engine even
//     where the interpreter is correct ($id-based URI resolution, URN bases,
//     empty JSON-pointer tokens, RE2-unsupported patterns).
//
// These cases assert final Validator verdicts, so they hold in both native and
// ATA_NO_NATIVE configurations.

const assert = require('assert')
const { Validator } = require('..')

// 1. unevaluatedItems + contains: contains-matched items count as evaluated.
{
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    if: { contains: { const: 'a' } },
    then: {
      if: { contains: { const: 'b' } },
      then: { if: { contains: { const: 'c' } } },
    },
    unevaluatedItems: false,
  }
  const v = new Validator(schema)
  assert.strictEqual(v.validate([]).valid, true, 'empty array')
  assert.strictEqual(v.validate(['a', 'a']).valid, true, "only a's")
  assert.strictEqual(v.validate(['a', 'b', 'a', 'b', 'a']).valid, true, "a's and b's")
  assert.strictEqual(v.validate(['c', 'a', 'c', 'c', 'b', 'a']).valid, true, "a's, b's and c's")
  assert.strictEqual(v.validate(['b', 'b']).valid, false, "only b's")
  assert.strictEqual(v.validate(['c', 'c']).valid, false, "only c's")
}

// 2. $anchor resolution respects $id base-URI scopes: "#bigint" from the root
// scope must hit the root-scope anchor, not the same-named anchor inside a
// nested $id scope.
{
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/draft2020-12/ref-and-id2/base.json',
    $ref: '#bigint',
    $defs: {
      bigint: { $anchor: 'bigint', maximum: 10 },
      smallint: {
        $id: 'https://example.com/draft2020-12/ref-and-id2/',
        $anchor: 'bigint',
        maximum: 2,
      },
    },
  }
  const v = new Validator(schema)
  assert.strictEqual(v.validate(5).valid, true, 'valid against root-scope anchor')
  assert.strictEqual(v.validate(1000).valid, false, 'exceeds root-scope maximum')
}

// 3a. URN base URI with JSON-pointer ref.
{
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:uuid:deadbeef-1234-0000-0000-4321feebdaed',
    properties: { foo: { $ref: 'urn:uuid:deadbeef-1234-0000-0000-4321feebdaed#/$defs/bar' } },
    $defs: { bar: { type: 'string' } },
  }
  const v = new Validator(schema)
  assert.strictEqual(v.validate({ foo: 'bar' }).valid, true, 'string valid via URN ref')
  assert.strictEqual(v.validate({ foo: 12 }).valid, false, 'non-string invalid via URN ref')
}

// 3b. Absolute-path reference within an $id'd subschema.
{
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'http://example.com/ref/absref.json',
    $defs: {
      a: { $id: 'http://example.com/ref/absref/foobar.json', type: 'number' },
      b: { $id: 'http://example.com/absref/foobar.json', type: 'string' },
    },
    $ref: '/absref/foobar.json',
  }
  const v = new Validator(schema)
  assert.strictEqual(v.validate('foo').valid, true, 'string valid via absolute-path ref')
  assert.strictEqual(v.validate(12).valid, false, 'number invalid via absolute-path ref')
}

// 3c. Empty tokens in $ref JSON pointer.
{
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: { '': { $defs: { '': { type: 'number' } } } },
    allOf: [{ $ref: '#/$defs//$defs/' }],
  }
  const v = new Validator(schema)
  assert.strictEqual(v.validate(1).valid, true, 'number valid via empty-token pointer')
  assert.strictEqual(v.validate('a').valid, false, 'non-number invalid via empty-token pointer')
}

// 3d. Unicode property escape the native regex engine cannot parse must not
// silently pass everything.
{
  const v = new Validator({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'string',
    pattern: '^\\p{Letter}+$',
  })
  assert.strictEqual(v.validate('Düsseldorf').valid, true, 'letters match')
  assert.strictEqual(v.validate('123').valid, false, 'digits do not match')
}

// 3e. unevaluated* combined with $dynamicRef routes to the engine that tracks
// evaluated properties through dynamic scopes.
{
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/unevaluated-properties-with-dynamic-ref/derived',
    $ref: './baseSchema',
    $defs: {
      derived: {
        $dynamicAnchor: 'addons',
        properties: { bar: { type: 'string' } },
      },
      baseSchema: {
        $id: './baseSchema',
        unevaluatedProperties: false,
        properties: { foo: { type: 'string' } },
        $dynamicRef: '#addons',
        $defs: {
          defaultAddons: { $dynamicAnchor: 'addons' },
        },
      },
    },
  }
  const v = new Validator(schema)
  assert.strictEqual(v.validate({ foo: 'foo', bar: 'bar' }).valid, true, 'no unevaluated properties')
  assert.strictEqual(v.validate({ foo: 'foo', bar: 'bar', baz: 'baz' }).valid, false, 'baz is unevaluated')
}

// Guard: a plain resolvable $dynamicRef schema keeps validating correctly on
// every engine (this shape stays on its current fast path).
{
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: { $dynamicRef: '#items' },
    $defs: { foo: { $dynamicAnchor: 'items', type: 'string' } },
  }
  const v = new Validator(schema)
  assert.strictEqual(v.validate(['a', 'b']).valid, true, 'strings valid via $dynamicRef')
  assert.strictEqual(v.validate([1]).valid, false, 'number invalid via $dynamicRef')
}

console.log('test_engine_routing: all assertions passed')
