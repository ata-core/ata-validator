'use strict'

// Runtime unevaluatedItems in the combined function (genUnevaluatedItemsDynamicC,
// emitAnnotI). The combined function is called directly here: through
// validate() the verdict can answer first and hide a wrong combined answer,
// which is how a nested `unevaluatedItems: true` that marked nothing got past
// a first check. Every case of the suite's unevaluatedItems file, plus shapes
// where a failing branch must leave no marks, is compared with the
// interpreter on verdict and error list, and the number compiled is reported.

const assert = require('node:assert')
const { Validator } = require('..')
const { compileToJSCombined } = require('../lib/js-compiler')
const { createInterpreter } = require('../lib/interpreter')

const D = '2020-12'
const groups = require('./suite/tests/draft2020-12/unevaluatedItems.json').map((g) => [g.schema, g.tests.map((t) => t.data)])
const S = 'https://json-schema.org/draft/2020-12/schema'
groups.push(
  [{ $schema: S, prefixItems: [{ type: 'string' }], allOf: [{ prefixItems: [true, { type: 'integer' }], unevaluatedItems: true, minItems: 5 }], unevaluatedItems: false }, [['a', 1, 2], ['a', 1, 2, 3, 4], ['a']]],
  [{ $schema: S, anyOf: [{ contains: { const: 'x' } }, { prefixItems: [true, true] }], unevaluatedItems: { type: 'number' } }, [['x', 1, 'x'], ['a', 'b', 3], ['a', 'b', 'c'], [1, 'x', 'y']]],
  [{ $schema: S, oneOf: [{ prefixItems: [{ type: 'string' }] }, { prefixItems: [{ type: 'integer' }] }], unevaluatedItems: false }, [['a'], [1], ['a', 1], [true]]],
  [{ $schema: S, if: { prefixItems: [{ const: 'a' }] }, then: { prefixItems: [true, { type: 'integer' }] }, else: { items: { type: 'string' } }, unevaluatedItems: false }, [['a', 1], ['a', 1, 2], ['b', 'c'], ['b', 2]]],
  [{ $schema: S, $defs: { two: { prefixItems: [true, true] } }, allOf: [{ $ref: '#/$defs/two' }], unevaluatedItems: { const: 0 } }, [[1, 2], [1, 2, 0], [1, 2, 3]]],
)

const shape = (errs) => JSON.stringify((errs || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.params, e.message]))
let compiled = 0, compared = 0
for (const [schema, docs] of groups) {
  const v = new Validator(schema)
  const fn = compileToJSCombined(v._schemaObj, { valid: true, errors: [] }, null, null, { runtimeShape: true })
  if (!fn) continue
  compiled++
  const interp = createInterpreter(v._schemaObj, {})
  for (const d of docs) {
    const a = fn(d), b = interp.validate(d)
    const sortedA = a.valid ? [] : require('../lib/rejections').sortErrorsBySchemaOrder(v._schemaObj, a.errors)
    const sortedB = b.valid ? [] : require('../lib/rejections').sortErrorsBySchemaOrder(v._schemaObj, b.errors)
    assert.strictEqual(a.valid, b.valid, `verdict ${JSON.stringify(schema).slice(0, 120)} on ${JSON.stringify(d)}`)
    assert.strictEqual(shape(sortedA), shape(sortedB), `errors ${JSON.stringify(schema).slice(0, 120)} on ${JSON.stringify(d)}`)
    compared++
  }
}
assert.ok(compiled >= 20, `only ${compiled} of ${groups.length} schemas compiled`)
console.log(`ok: runtime unevaluatedItems in the combined function answers as the interpreter does (${compiled} of ${groups.length} schemas compiled, ${compared} documents, draft ${D})`)
