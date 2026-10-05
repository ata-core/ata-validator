'use strict'

// propertyNames with any subschema, not only the string keywords the key loop
// can check inline, is generated: each key is checked as a value of its own,
// and its errors are reported at the object, as the interpreter reports them.
// One such node used to send the whole schema to the interpreter (19 of
// SchemaStore's schemas). The combined and error functions are called directly
// as well as through a Validator, since the verdict answers first there and
// would hide an error function that wrongly passes.

const assert = require('node:assert')
const { Validator } = require('..')
const jc = require('../lib/js-compiler')

const schemas = [
  { type: 'object', propertyNames: { anyOf: [{ minLength: 3 }, { pattern: '^x' }] } },
  { $defs: { k: { type: 'string', maxLength: 4, not: { const: 'bad' } } }, type: 'object', propertyNames: { $ref: '#/$defs/k' } },
  { type: 'object', properties: { a: { type: 'object', propertyNames: { type: 'string', format: 'email' } } } },
  { propertyNames: { type: 'integer' } },
  { patternProperties: { '^x': { type: 'number' } }, additionalProperties: false, propertyNames: { oneOf: [{ const: 'xa' }, { minLength: 2 }] } },
  { type: 'array', items: { type: 'object', propertyNames: { allOf: [{ minLength: 1 }, { not: { enum: ['__proto__x', 'id'] } }] }, required: ['n'] } },
]
const docs = [{}, { ab: 1, xy: 2, c: 3 }, { abcd: 1 }, { bad: 1, ok: 2 }, { a: { 'q@w.e': 1, no: 2 } }, { xa: 1, xb: 's' }, [], 's', { abcde: 1, x: 1 },
  [{ n: 1 }, { id: 2, n: 1 }, { '': 1 }], { 'a/b~c': 1 }]
const shape = (errs) => (errs || []).map((e) => JSON.stringify([e.keyword, e.instancePath, e.schemaPath, e.params, e.message])).sort().join('\n')

let compared = 0
for (const [i, raw] of schemas.entries()) {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...raw }
  const interp = new Validator(schema, { engine: 'interpreter', richErrors: false })
  const lean = new Validator(schema, { richErrors: false })
  const rich = new Validator(schema)
  const richInterp = new Validator(schema, { engine: 'interpreter' })
  const comb = jc.compileToJSCombined(schema, { valid: true, errors: [] }, null, null, { runtimeShape: true })
  const errFn = jc.compileToJSCodegenWithErrors(schema, null, null, { runtimeShape: true })
  assert.ok(comb && errFn, `schema ${i}: expected the combined and error functions`)
  for (let r = 0; r < 70; r++) for (const d of docs) { void lean.validate(d).errors; void rich.validate(d).errors }
  assert.strictEqual(lean.engine(), 'codegen', `schema ${i} runs on generated code`)
  for (const d of docs) {
    const want = interp.validate(d)
    const label = `schema ${i}, ${JSON.stringify(d)}`
    assert.strictEqual(lean.validate(d).valid, want.valid, 'verdict, ' + label)
    assert.strictEqual(shape(lean.validate(d).errors), shape(want.errors), 'errors, ' + label)
    assert.strictEqual(JSON.stringify(rich.validate(d).errors), JSON.stringify(richInterp.validate(d).errors), 'rich errors, ' + label)
    const c = comb(d)
    assert.strictEqual(c.valid, want.valid, 'combined verdict, ' + label)
    if (!want.valid) assert.strictEqual(shape(c.errors), shape(want.errors), 'combined errors, ' + label)
    const e = errFn(d, true)
    assert.strictEqual(e.valid, want.valid, 'error function verdict, ' + label)
    if (!want.valid) assert.strictEqual(shape(e.errors), shape(want.errors), 'error function errors, ' + label)
    compared++
  }
}
console.log(`ok: propertyNames with any subschema is generated and agrees with the interpreter (${schemas.length} schemas, ${compared} documents, five reads each)`)
