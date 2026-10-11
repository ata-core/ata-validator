'use strict'

// Custom keywords with `dataContext: true` are given where their value sits
// ({ instancePath, parentData, parentDataProperty, rootData }), as the default
// validator's keywords are, and may change it there. Held on nested objects
// and arrays, on both the verdict and the error path, and through compat with
// an ajv-style keyword shaped like express-openapi-validator's readOnly.

const assert = require('assert')
const { Validator } = require('..')
const Ajv = require('../compat')

const seen = []
const keywords = {
  readOnly: {
    dataContext: true,
    compile: (on) => on ? (data, ctx) => { seen.push([ctx.instancePath, ctx.parentDataProperty, ctx.rootData === root]); delete ctx.parentData[ctx.parentDataProperty]; return true } : () => true,
  },
  even: { dataContext: true, validate: (on, data, parent, ctx) => { if (data % 2 === 0) return true; return false } },
}
const schema = { type: 'object', properties: { id: { type: 'string', readOnly: true }, rows: { type: 'array', items: { type: 'object', properties: { sku: { readOnly: true }, n: { type: 'integer', even: true } } } } } }
const v = new Validator(schema, { keywords })
let root = { id: 'x', rows: [{ sku: 'a', n: 2 }, { sku: 'b', n: 4 }] }
assert.strictEqual(v.validate(root).valid, true)
assert.deepStrictEqual(root, { rows: [{ n: 2 }, { n: 4 }] }, 'read-only values removed where they sit')
assert.deepStrictEqual(seen, [['/id', 'id', true], ['/rows/0/sku', 'sku', true], ['/rows/1/sku', 'sku', true]], 'paths, keys and root as the default validator gives them')
root = { rows: [{ sku: 'c', n: 3 }] }
seen.length = 0
assert.strictEqual(v.isValidObject(root), false, 'the verdict path runs the keywords with their context too')
assert.deepStrictEqual(root, { rows: [{ n: 3 }] })
const r = v.validate({ rows: [{}, { n: 5 }] })
assert.strictEqual(r.valid, false)
assert.strictEqual(r.errors[0].instancePath, '/rows/1/n', 'the error is placed at the value')
console.log('ok: a context-reading keyword gets the value\'s place, on nested objects and arrays, verdict and errors')

// Through compat, the reference's keyword shape: compile(schema, parentSchema,
// it) and a function of (data, dataCxt) writing its own errors with the
// absolute path it was given.
const ajv = new Ajv({ allErrors: true })
ajv.removeKeyword('readOnly')
ajv.addKeyword({
  keyword: 'readOnly',
  errors: true,
  compile: (sch, parent, it) => {
    if (!sch) return () => true
    const validate = (data, ctx) => {
      const ok = data == null
      if (!ok) validate.errors = [{ keyword: 'readOnly', instancePath: ctx.instancePath, schemaPath: it.schemaPath.str, params: { writeOnly: ctx.parentDataProperty }, message: 'is read-only' }]
      return ok
    }
    return validate
  },
})
const f = ajv.compile({ type: 'object', properties: { id: { type: 'string', readOnly: true }, list: { type: 'array', items: { type: 'object', properties: { k: { readOnly: true } } } } } })
assert.strictEqual(f({ list: [{}] }), true)
assert.strictEqual(f({ id: 'x', list: [{}, { k: 1 }] }), false)
assert.deepStrictEqual(f.errors.map((e) => [e.keyword, e.instancePath, e.schemaPath, e.params.writeOnly]), [['readOnly', '/id', '#/properties/id', 'id'], ['readOnly', '/list/1/k', '#/properties/list/items/properties/k', 'k']])
console.log('ok: compat gives keywords the reference\'s data context and it.schemaPath')
