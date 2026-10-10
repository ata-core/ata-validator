'use strict'

// Errors behind a $ref come out in the order they would inline, on every
// engine. Their schemaPath is the evaluation path, which runs on past the
// `$ref` into keys the referencing node does not have, so the declaration
// order sort used to rank them all at the `$ref` site and keep whatever order
// the engine emitted: additionalProperties first from the generated code,
// the document's key order from the interpreter. Found on SchemaStore, where
// 19 schemas reported the same errors in a different order per engine.
//
// Also here: the errors generator wrote a patternProperties key into the
// schemaPath literal without escaping it, so `^\d+$` came out as `^d+$` and a
// key with a quote made the generator decline.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { compileToJSCodegenWithErrors } = require('../lib/js-compiler')
const { compiledModuleFor, compiledSchemaFor } = require('../build')
const { fromCompiled } = require('../lib/compiled')

let passed = 0
function check (name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('error order behind $ref\n')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-ref-order-'))
let n = 0
function compiled (schema) {
  const src = compiledModuleFor(schema, { format: 'cjs' })
  if (src === null) return null
  const f = path.join(dir, `m${n++}.cjs`)
  fs.writeFileSync(f, src)
  return fromCompiled(require(f), compiledSchemaFor(schema))
}

const T = {
  type: 'object',
  properties: { a: { type: 'string' }, d: { type: 'object', patternProperties: { '^.*$': { type: 'string' } } } },
  required: ['r'],
  additionalProperties: false,
}
const shapes = {
  inline: [{ type: 'object', properties: { m: T } }, (o) => ({ m: o })],
  property: [{ definitions: { T }, type: 'object', properties: { m: { $ref: '#/definitions/T' } } }, (o) => ({ m: o })],
  root: [{ definitions: { T }, $ref: '#/definitions/T' }, (o) => o],
  pattern: [{ definitions: { T }, type: 'object', properties: { m: { type: 'object', patternProperties: { '^\\d+$': { $ref: '#/definitions/T' } } } } }, (o) => ({ m: { 1: o } })],
  nested: [{ $defs: { U: { $ref: '#/$defs/T' }, T }, type: 'object', properties: { m: { $ref: '#/$defs/U' } } }, (o) => ({ m: o })],
  // A draft-07 schema: normalization renames `definitions` to `$defs` and
  // keeps the pointer as written.
  draft7: [{ $schema: 'http://json-schema.org/draft-07/schema#', definitions: { T }, type: 'object', properties: { m: { $ref: '#/definitions/T' } } }, (o) => ({ m: o })],
}
// The same failures with the stray key first, in the middle and last.
const docs = [{ a: 1, d: { x: 1 }, zz: 1 }, { zz: 1, a: 1, d: { x: 1 } }, { d: { x: 1 }, zz: 1, a: 1 }]
const keywords = (r) => r.errors.map((e) => e.keyword + '@' + e.instancePath.split('/').slice(-1)[0])

check('every engine and compile-away report the inline order', () => {
  const want = ['type@a', 'type@x', 'required@', 'additionalProperties@']
  let compiledShapes = 0
  for (const [name, [schema, wrap]] of Object.entries(shapes)) {
    const engines = {
      default: new Validator(schema),
      interpreter: new Validator(schema, { engine: 'interpreter' }),
    }
    // Every shape compiles, the $ref to a $ref (an alias) included.
    const c = compiled(schema)
    if (c) { engines.compiled = c; compiledShapes++ }
    for (const o of docs) {
      for (const [engine, v] of Object.entries(engines)) {
        const got = keywords(v.validate(structuredClone(wrap(o))))
        // The last segment of the instance path names the property; the two
        // object-level errors end in the object's own key, normalised here.
        const norm = got.map((k) => (k.startsWith('required@') || k.startsWith('additionalProperties@')) ? k.split('@')[0] + '@' : k)
        assert.deepStrictEqual(norm, want, `${name} ${engine} ${JSON.stringify(o)}`)
      }
    }
  }
  assert.strictEqual(compiledShapes, 6, 'compile-away covered ' + compiledShapes + ' shapes')
})

check('a $ref declared after a sibling keyword sorts after it', () => {
  const schema = { $defs: { T: { type: 'object', required: ['r'] } }, type: 'object', properties: { m: { minProperties: 3, $ref: '#/$defs/T' } } }
  for (const v of [new Validator(schema), new Validator(schema, { engine: 'interpreter' })]) {
    assert.deepStrictEqual(v.validate({ m: {} }).errors.map((e) => e.keyword), ['minProperties', 'required'])
  }
})

// The same through a reference into another document (the `schemas` option):
// the order sort followed only pointers into the root, so both engines kept
// their own emit order and disagreed. Found on 64 schemas that reference each
// other by $id.
check('errors behind a reference into another document keep the inline order', () => {
  const want = ['type@a', 'type@x', 'required@', 'additionalProperties@']
  const C = { $id: 'https://example.test/c.json', $defs: { T } }
  const roots = {
    absolute: { $id: 'https://example.test/r.json', type: 'object', properties: { m: { $ref: 'https://example.test/c.json#/$defs/T' } } },
    relative: { $id: 'https://example.test/r.json', type: 'object', properties: { m: { $ref: 'c.json#/$defs/T' } } },
    // Inside the other document, a pointer resolves against that document.
    hop: { $id: 'https://example.test/r.json', type: 'object', properties: { m: { $ref: 'd.json' } } },
  }
  const D = { $id: 'https://example.test/d.json', $ref: 'c.json#/$defs/T' }
  for (const [name, schema] of Object.entries(roots)) {
    // Two validators of the one schema object, each with its own `schemas`
    // array, as a server with a validator per route has.
    const engines = {
      default: new Validator(schema, { schemas: [C, D] }),
      interpreter: new Validator(schema, { schemas: [C, D], engine: 'interpreter' }),
    }
    for (const o of docs) {
      for (const [engine, v] of Object.entries(engines)) {
        const norm = keywords(v.validate(structuredClone({ m: o }))).map((k) => (k.startsWith('required@') || k.startsWith('additionalProperties@')) ? k.split('@')[0] + '@' : k)
        assert.deepStrictEqual(norm, want, `${name} ${engine} ${JSON.stringify(o)}`)
      }
    }
  }
})

check('one id given two different schemas leaves the order as the engines emit it', () => {
  const root = { $id: 'https://example.test/r2.json', type: 'object', properties: { m: { $ref: 'c.json' } } }
  const a = new Validator(root, { schemas: [{ $id: 'https://example.test/c.json', type: 'object', required: ['x'], minProperties: 2 }] })
  const b = new Validator(root, { schemas: [{ $id: 'https://example.test/c.json', type: 'object', minProperties: 2, required: ['x'] }] })
  // Each validator still answers from its own registry; only the ordering
  // stops following the reference.
  assert.deepStrictEqual(a.validate({ m: {} }).errors.map((e) => e.keyword).sort(), ['minProperties', 'required'])
  assert.deepStrictEqual(b.validate({ m: {} }).errors.map((e) => e.keyword).sort(), ['minProperties', 'required'])
})

check('the errors generator keeps backslashes and quotes in patternProperties keys', () => {
  for (const key of ['^\\d+$', "^it's$", '^a/b~c$']) {
    const schema = { type: 'object', patternProperties: { [key]: { type: 'object', required: ['x'] } } }
    const doc = { 1: {}, "it's": {}, 'a/b~c': {} }
    const fn = compileToJSCodegenWithErrors(schema)
    assert.ok(fn, `the generator declined ${key}`)
    const want = new Validator(schema, { engine: 'interpreter' }).validate(doc).errors.map((e) => e.schemaPath)
    assert.deepStrictEqual(fn(doc, true).errors.map((e) => e.schemaPath), want, key)
  }
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed`)
