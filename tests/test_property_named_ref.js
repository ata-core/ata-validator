'use strict'

// A property named "$ref" (an object of JSON references, a schema that
// describes schemas, Kubernetes' definitions) is an ordinary key to every
// generator: `properties.$ref` is a map entry, not a reference, because a
// reference is a string. Such a schema used to be sent to the interpreter
// whole. Held here to the interpreter on every read: validate() lean and
// rich, isValidObject, validateJSON and isValidJSON from text, and the
// combined and error functions called directly.

const assert = require('node:assert')
const { Validator } = require('..')
const jc = require('../lib/js-compiler')

const schemas = [
  { type: 'object', properties: { $ref: { type: 'string', minLength: 2 }, b: { type: 'integer' } }, required: ['$ref'] },
  { $defs: { R: { type: 'object', properties: { $ref: { type: 'string', pattern: '^#' }, $id: { type: 'string' } }, additionalProperties: false } }, type: 'array', items: { $ref: '#/$defs/R' } },
  { type: 'object', properties: { $ref: { $ref: '#/$defs/S' } }, $defs: { S: { type: 'string', maxLength: 5 } } },
  { type: 'object', properties: { x: { type: 'object', properties: { $ref: { oneOf: [{ type: 'string' }, { type: 'null' }] } } } }, unevaluatedProperties: false },
]
const docs = [{}, { $ref: 'ab' }, { $ref: 'a' }, { $ref: 1, b: 'x' }, [{ $ref: '#/a' }, { $ref: 'x' }, { $ref: '#', z: 1 }], { $ref: 'abcdefg' },
  { x: { $ref: null } }, { x: { $ref: 3 }, y: 1 }, { $ref: '#/x', $id: 'i' }]
const shape = (errs) => (errs || []).map((e) => JSON.stringify([e.keyword, e.instancePath, e.schemaPath, e.params])).sort().join('\n')

let compared = 0
for (const [i, raw] of schemas.entries()) {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...raw }
  const interp = new Validator(schema, { engine: 'interpreter', richErrors: false })
  const richInterp = new Validator(schema, { engine: 'interpreter' })
  const lean = new Validator(schema, { richErrors: false })
  const rich = new Validator(schema)
  const comb = jc.compileToJSCombined(schema, { valid: true, errors: [] }, null, null, { runtimeShape: true })
  const errFn = jc.compileToJSCodegenWithErrors(schema, null, null, { runtimeShape: true })
  assert.ok(comb && errFn, `schema ${i}: expected the combined and error functions`)
  for (let r = 0; r < 70; r++) for (const d of docs) { void lean.validate(d).errors; void rich.validate(d).errors; lean.isValidJSON(JSON.stringify(d)) }
  assert.strictEqual(lean.engine(), 'codegen', `schema ${i} runs on generated code`)
  for (const d of docs) {
    const want = interp.validate(d)
    const text = JSON.stringify(d)
    const label = `schema ${i}, ${text}`
    assert.strictEqual(shape(lean.validate(d).errors), shape(want.errors), 'errors, ' + label)
    assert.strictEqual(lean.isValidObject(d), want.valid, 'isValidObject, ' + label)
    assert.strictEqual(lean.isValidJSON(text), want.valid, 'isValidJSON, ' + label)
    const vj = lean.validateJSON(text)
    assert.strictEqual(vj.valid, want.valid, 'validateJSON, ' + label)
    if (!want.valid) assert.strictEqual(shape(vj.errors), shape(want.errors), 'validateJSON errors, ' + label)
    assert.strictEqual(JSON.stringify(rich.validate(d).errors), JSON.stringify(richInterp.validate(d).errors), 'rich errors, ' + label)
    const c = comb(d)
    assert.strictEqual(c.valid, want.valid, 'combined, ' + label)
    if (!want.valid) assert.strictEqual(shape(c.errors), shape(want.errors), 'combined errors, ' + label)
    const e = errFn(d, true)
    assert.strictEqual(e.valid, want.valid, 'error function, ' + label)
    if (!want.valid) assert.strictEqual(shape(e.errors), shape(want.errors), 'error function errors, ' + label)
    compared++
  }
}
console.log(`ok: a property named $ref is generated and agrees with the interpreter (${schemas.length} schemas, ${compared} documents, eight reads each)`)
