'use strict'

// A module written with `plainErrors` (ata-validator/compiled-plain) against
// `new Validator(schema, { richErrors: false })`, in the places the suite's
// schemas do not reach. Found by scripts/gate.js over SchemaStore:
//   - a schema whose one-pass program has no source form (a recursive
//     reference inside an anyOf branch) took the older collector, and its
//     plain errors came with `code` and `docUrl`, in the collector's order;
//   - more than sixteen errors out of order were left as the program found
//     them, where the runtime sorts them.
// And for the interpreted engine and its closure tree: a required property
// present with the value undefined was reported after the other missing
// names, where generated code reports the names in the order `required`
// lists them.

const assert = require('node:assert')
const Module = require('node:module')
const path = require('node:path')
const { Validator } = require('..')
const build = require('../build.js')
const { fromCompiledPlain } = require('../lib/compiled-plain')

function plain (schema, order) {
  const src = build.compiledModuleFor(schema, order ? { format: 'cjs', plainErrors: true, order: true } : { format: 'cjs', plainErrors: true })
  const m = new Module('plain'); m.filename = path.join(__dirname, 'plain.cjs'); m.paths = Module._nodeModulePaths(__dirname); m._compile(src, m.filename)
  return { src, v: fromCompiledPlain(m.exports, build.compiledSchemaFor(schema), { richErrors: false }) }
}
const same = (schema, docs, label, order) => {
  const { src, v } = plain(schema, order)
  const want = new Validator(schema, { richErrors: false })
  let rejected = 0
  for (const d of docs) {
    const a = want.validate(structuredClone(d)); const b = v.validate(structuredClone(d))
    assert.strictEqual(JSON.stringify(b.errors), JSON.stringify(a.errors), `${label}: ${JSON.stringify(d).slice(0, 80)}`)
    if (!a.valid) rejected++
  }
  assert.ok(rejected > 0, label)
  return src
}

// The collector, for a program that cannot be written out.
const recursive = {
  type: 'object',
  properties: {
    a: { type: 'array', items: { type: 'object', anyOf: [{ properties: { name: { type: 'string' } }, required: ['name'] }, { $ref: '#' }] } },
    h: { type: 'array', items: { type: 'object' } },
  },
  required: ['u'],
}
const src1 = same(recursive, [{ h: [true] }, { h: [1, 2], a: [1] }, { u: 1, a: [{ name: 1 }] }, { u: 1 }, {}], 'collector')
assert.ok(!src1.includes('_vC'), 'this schema is expected to take the collector; if it takes the one-pass program now, pick another')

// More than sixteen errors, out of schema order, every place known.
const wide = { type: 'object', properties: {}, additionalProperties: false, required: [] }
for (let i = 0; i < 12; i++) { wide.properties['p' + i] = { type: 'string', minLength: 2 }; wide.required.push('r' + i) }
const doc = { zz: 1, yy: 2 }
for (let i = 11; i >= 0; i--) doc['p' + i] = i % 2 ? 1 : 'x'
same(wide, [doc, { p3: 1 }, Object.fromEntries(wide.required.map((k) => [k, 1]))], 'long list')

// A list the program cannot order itself (a pattern property's subschema
// next to `required`; items behind a shared definition): with `order: true`
// the module imports ata-validator/order and the wrapper hands it the
// schema. Without it the module imports nothing, as before.
const nested = { type: 'object', properties: { m: { patternProperties: { '^[a-z]+$': { type: 'object' } } } }, required: ['k'] }
const shared = { type: 'object', properties: { p: { type: 'object', additionalProperties: { $ref: '#/$defs/x' } } }, $defs: { x: { type: 'object', properties: { a: { enum: [1] }, b: { type: 'string' } } } } }
for (const [schema, docs] of [[nested, [{ m: { bogus: 1 } }, { k: 1, m: { x: 1, y: 2 } }]], [shared, [{ p: { A: { a: 2, b: 1 }, B: { b: 2, a: 3 }, C: { a: 4 } } }]]]) {
  const src = same(schema, docs, 'imported sort', true)
  if (schema === nested) assert.ok(src.includes('require("ata-validator/order")'), 'the module imports the sort')
  assert.ok(!plain(schema).src.includes('ata-validator/order'), 'not unless asked')
}
const { ordered } = require('../order.js')
import('../order.mjs').then((m) => {
  const errs = [{ schemaPath: '#/required' }, { schemaPath: '#/properties/m/type' }]
  assert.deepStrictEqual(m.ordered(nested, errs.slice()).map((e) => e.schemaPath), ['#/properties/m/type', '#/required'])
  assert.deepStrictEqual(ordered(nested, errs.slice()).map((e) => e.schemaPath), ['#/properties/m/type', '#/required'])
})

// A required property that holds undefined, on the walk and on the closure tree.
const req = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }, required: ['a', 'b', 'c'] }
const names = (v, d) => v.validate(d).errors.map((e) => e.params.missingProperty).join()
const tree = new Validator(req, { engine: 'interpreter' })
for (let i = 0; i < 1200; i++) tree.isValidObject(i % 2 ? {} : [])
for (const v of [new Validator(req), new Validator(req, { engine: 'interpreter' }), tree, new Validator(req, { richErrors: false })]) {
  assert.strictEqual(names(v, { a: undefined }), 'a,b,c')
  assert.strictEqual(names(v, { b: undefined }), 'a,b,c')
  assert.strictEqual(names(v, { a: 'x', c: undefined }), 'b,c')
  assert.strictEqual(names(v, { a: 'x', b: 'y', c: undefined }), 'c')
  assert.strictEqual(v.isValidObject({ a: 'x', b: 'y', c: undefined }), false)
  assert.strictEqual(v.isValidObject({ a: 'x', b: 'y', c: 'z' }), true)
}

console.log('test_compiled_plain_order: ok')
