'use strict'

// $ref with validating siblings in the combined function (2020-12 applies
// both). The combined function is called directly, so the verdict cannot
// answer first and hide a dropped sibling, which is how this once accepted
// what the siblings reject. Includes the same schema object reached once
// through a reference with siblings and once without, so the mark that the
// reference was written cannot leak from one to the other.

const assert = require('node:assert')
const { Validator } = require('..')
const { compileToJSCombined } = require('../lib/js-compiler')
const { createInterpreter } = require('../lib/interpreter')
const { sortErrorsBySchemaOrder } = require('../lib/rejections')

const S = 'https://json-schema.org/draft/2020-12/schema'
const shared = { $ref: '#/$defs/n', maxItems: 2 }
const cases = [
  [{ $schema: S, $defs: { n: { type: 'array', items: { type: 'integer' } } }, $ref: '#/$defs/n', maxItems: 2, contains: { const: 1 } }, [[1], [1, 2, 3], ['a'], [2], [1, 'b']]],
  [{ $schema: S, $defs: { o: { type: 'object', properties: { a: { type: 'string' } } } }, $ref: '#/$defs/o', required: ['b'], unevaluatedProperties: false }, [{ a: 'x', b: 1 }, { b: 1, c: 2 }, { a: 1 }, {}]],
  [{ $schema: S, $defs: { p: { prefixItems: [{ type: 'string' }] } }, $ref: '#/$defs/p', unevaluatedItems: { type: 'number' } }, [['a', 1], ['a', 'b'], [1], []]],
  [{ $schema: S, $defs: { n: { type: 'array', items: { type: 'integer' } } }, properties: { x: shared, y: { allOf: [shared] }, z: { $ref: '#/$defs/n' } } }, [{ x: [1, 2, 3], y: [1, 2, 3], z: [1, 2, 3] }, { x: ['a'], z: ['b'] }, { y: [1] }]],
]
const shape = (errs) => JSON.stringify((errs || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.params]))
let compared = 0
for (const [schema, docs] of cases) {
  const v = new Validator(schema)
  const fn = compileToJSCombined(v._schemaObj, { valid: true, errors: [] }, null, null, { runtimeShape: true })
  assert.strictEqual(typeof fn, 'function', `the combined function compiles for ${JSON.stringify(schema).slice(0, 100)}`)
  const it = createInterpreter(v._schemaObj, {})
  for (const d of docs) {
    const a = fn(d), b = it.validate(d)
    assert.strictEqual(a.valid, b.valid, `verdict on ${JSON.stringify(d)} for ${JSON.stringify(schema).slice(0, 100)}`)
    if (!a.valid) assert.strictEqual(shape(sortErrorsBySchemaOrder(v._schemaObj, a.errors)), shape(sortErrorsBySchemaOrder(v._schemaObj, b.errors)), `errors on ${JSON.stringify(d)}`)
    compared++
  }
}
console.log(`ok: $ref beside validating keywords compiles into the combined function and answers as the interpreter does (${compared} documents)`)
