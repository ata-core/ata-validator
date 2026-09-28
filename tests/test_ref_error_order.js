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
    // A $ref to a $ref runs on the interpreter, so there is no module for it.
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
  assert.strictEqual(compiledShapes, 5, 'compile-away covered ' + compiledShapes + ' shapes')
})

check('a $ref declared after a sibling keyword sorts after it', () => {
  const schema = { $defs: { T: { type: 'object', required: ['r'] } }, type: 'object', properties: { m: { minProperties: 3, $ref: '#/$defs/T' } } }
  for (const v of [new Validator(schema), new Validator(schema, { engine: 'interpreter' })]) {
    assert.deepStrictEqual(v.validate({ m: {} }).errors.map((e) => e.keyword), ['minProperties', 'required'])
  }
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
