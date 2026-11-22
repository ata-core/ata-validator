'use strict'

// Validator.fromStandalone() wraps what toStandalone() writes, and fills
// defaults before the verdict as a Validator does. It built the defaults pass
// from the root schema alone, so a default in a document given through the
// `schemas` option was never filled, and only validate() ran the pass:
// isValidObject(), isValidJSON() and validateJSON() judged the document as
// it came. A default that does not meet its own schema was accepted there
// while a Validator rejects it (a silent accept), a required name with a
// default was rejected where a Validator fills it and accepts (a wrong
// reject), and `useDefaults: false` still filled. Every read is held to a
// Validator with the same options here.

const assert = require('assert')
const path = require('path')
const Module = require('module')
const { Validator } = require('..')
const aot = require('../lib/aot-impl.js')

const load = (src) => { const m = new Module('fs-test'); m.filename = path.join(__dirname, '..', 'fs-test.cjs'); m.paths = Module._nodeModulePaths(path.join(__dirname, '..')); m._compile(src, m.filename); return m.exports }
const b = 'https://e.x/fs/'
const reg = [{ $id: b + 'r.json', type: 'object', properties: { flag: { type: 'boolean', default: 'false' }, n: { type: 'integer', default: 1 } }, required: ['n'] }]
const cases = [
  [{ type: 'object', properties: { flag: { type: 'boolean', default: 'false' } } }, null],
  [{ type: 'object', properties: { n: { type: 'integer', default: 1 } }, required: ['n'] }, null],
  [{ $ref: b + 'r.json' }, reg],
  [{ type: 'object', properties: { p: { $ref: b + 'r.json' } }, required: ['p'] }, reg],
]
const docs = [{}, { flag: true }, { n: 2 }, { p: {} }, { p: { n: 1, flag: true } }]
let checked = 0
for (const [s, schemas] of cases) {
  for (const extra of [{}, { useDefaults: false }]) {
    const opts = schemas ? { ...extra, schemas } : extra
    const src = aot.toStandalone(new Validator(structuredClone(s), structuredClone(opts)))
    const v = Validator.fromStandalone(load(src), structuredClone(s), structuredClone(opts))
    for (const d of docs) {
      const ref = new Validator(structuredClone(s), structuredClone(opts))
      const want = ref.validate(structuredClone(d)).valid
      const where = `${JSON.stringify(s)} ${JSON.stringify(extra)} on ${JSON.stringify(d)}`
      assert.strictEqual(v.validate(structuredClone(d)).valid, want, `validate ${where}`)
      assert.strictEqual(v.isValidObject(structuredClone(d)), want, `isValidObject ${where}`)
      assert.strictEqual(v.isValidJSON(JSON.stringify(d)), want, `isValidJSON ${where}`)
      assert.strictEqual(v.validateJSON(JSON.stringify(d)).valid, want, `validateJSON ${where}`)
      const a = structuredClone(d); const c = structuredClone(d)
      ref.validate(a); v.validate(c)
      assert.deepStrictEqual(c, a, `the document afterwards ${where}`)
      checked += 5
    }
  }
}
console.log(`ok: fromStandalone fills defaults as a Validator does, from registered documents too, on every read (${checked} answers)`)
