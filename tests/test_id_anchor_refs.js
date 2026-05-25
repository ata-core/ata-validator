'use strict'

// A draft-07 plain-name anchor is declared with `$id: "#name"` on a definition,
// and referenced with `$ref: "#name"`. The codegen anchor map only picked up
// `$anchor`/`$dynamicAnchor`, so a `$id`-style anchor made every codegen path
// bail to null, which forced the native fallback. That fallback could not
// resolve sibling refs (e.g. an external `$ref: "schema#"`), surfacing as
// "cannot resolve $ref". Register `$id` plain-name anchors too so the JS
// codegen handles these schemas. Matches Fastify's shared-schema usage.

const assert = require('assert')
const { Validator } = require('..')
const { compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined } = require('../lib/js-compiler')

// Map for the compile-function calls (they take a schemaMap directly); object
// for the Validator `schemas` option (the shape Fastify passes).
const externalSchema = { $id: 'http://foo/test', type: 'object', properties: { id: { type: 'number' } } }
const map = new Map([['http://foo/test', externalSchema]])
const externalSchemas = { 'http://foo/test': externalSchema }

// 1. None of the codegen paths bail on a $id-anchor definition.
{
  const schema = {
    $id: 'http://foo/u',
    definitions: { address: { $id: '#address', type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
    type: 'object',
    properties: { address: { $ref: '#address' } },
    required: ['address'],
  }
  assert.ok(compileToJSCodegen(schema, map) != null, 'compileToJSCodegen bails on $id-anchor def')
  assert.ok(compileToJSCodegenWithErrors(schema, map) != null, 'compileToJSCodegenWithErrors bails on $id-anchor def')
  assert.ok(compileToJSCombined(schema, { valid: true, errors: [] }, map) != null, 'compileToJSCombined bails on $id-anchor def')
}

// 2. End to end (Fastify shape): external trailing-# ref + local $id anchor.
{
  const body = {
    $id: 'http://foo/user',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    definitions: { address: { $id: '#address', type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
    required: ['address'],
    properties: {
      test: { $ref: 'http://foo/test#' }, // external, trailing empty fragment
      address: { $ref: '#address' },       // local draft-07 anchor
    },
  }
  const v = new Validator(body, { schemas: externalSchemas })

  const good = v.validate({ test: { id: 1 }, address: { city: 'Istanbul' } })
  assert.strictEqual(good.valid, true, `valid data rejected: ${JSON.stringify(good.errors)}`)

  const bad = v.validate({ test: { id: 1 }, address: {} }) // missing city
  assert.strictEqual(bad.valid, false, 'invalid data accepted')
  assert.ok(
    !bad.errors.some((e) => /cannot resolve/i.test(e.message || '')),
    `ref left unresolved: ${JSON.stringify(bad.errors)}`,
  )
  assert.ok(
    bad.errors.some((e) => (e.instancePath || '').startsWith('/address')),
    `expected a /address error, got: ${JSON.stringify(bad.errors)}`,
  )
}

console.log('ok: $id plain-name anchors resolve in the codegen path')
