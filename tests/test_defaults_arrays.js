'use strict'

// `properties` applies to objects, and so do the defaults under it. Both
// defaults passes (the closure pass in lib/defaults.js and the generated one
// in lib/codegen-engine.js) wrote them onto arrays too, as named properties:
// `[1]` validated against `{ properties: { A: { default: 0 } } }` came back
// with keys 0 and A, on every path and since the passes reached arrays. A
// `not` over the same property then judged the changed array, and the default
// engine left that `not` error out where the interpreted engine reported it
// (SchemaStore's sil-kit-participant-configuration, found 2026-11-08 by the
// all-paths differential). Held here: arrays come back as they were sent, and
// objects inside arrays are still filled.

const assert = require('node:assert')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

function load (src) {
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, require)
  return m.exports
}

const schemas = {
  'properties at the root': { properties: { A: { default: 0 } } },
  'properties under items': { items: { properties: { A: { default: 0 } } } },
  'a not over the same property': { type: 'object', properties: { A: { enum: [1, '1'], default: 0 } }, not: { properties: { A: { enum: [1, '1'], default: 0 } } } },
  'nested object default': { properties: { o: { default: {}, properties: { B: { default: 'b' } } } } },
}
const paths = {
  'first verdict': (v, d) => v.isValidObject(d),
  'validate()': (v, d) => v.validate(d),
  'generated code': (v, d) => { v._coldCalls = 64; v.validate({}); v.validate(d) },
}

let n = 0
for (const [name, schema] of Object.entries(schemas)) {
  const docs = () => [[1], [[1], { x: 1 }], [{}, 2], []]
  for (const [pname, run] of Object.entries(paths)) {
    for (const engine of [undefined, 'interpreter']) {
      for (const d of docs()) {
        const v = new Validator(schema, engine ? { engine } : {})
        const before = JSON.stringify(d)
        run(v, d)
        const walk = (x) => { if (Array.isArray(x)) { assert.deepStrictEqual(Object.keys(x), x.map((_, i) => String(i)), `${name}, ${pname}, ${engine || 'default'}: an array of ${before} took a named key`); x.forEach(walk) } else if (x && typeof x === 'object') Object.values(x).forEach(walk) }
        walk(d)
        n++
      }
    }
  }
}

// Objects inside an array are still filled, on both engines and in a module.
const items = schemas['properties under items']
for (const opts of [{}, { engine: 'interpreter' }]) {
  const v = new Validator(items, opts)
  const d = [{}, [1], { A: 5 }]
  v.validate(d)
  assert.deepStrictEqual(d[0], { A: 0 }, 'an object element is filled')
  assert.deepStrictEqual(Object.keys(d[1]), ['0'], 'an array element is not')
  assert.deepStrictEqual(d[2], { A: 5 }, 'a present key is kept')
}
const mod = load(toStandaloneModule(new Validator(items), { format: 'cjs' }))
if (typeof mod.applyDefaults === 'function') {
  const d = [{}, [1]]
  mod.applyDefaults(d)
  assert.deepStrictEqual(d[0], { A: 0 }, 'module: an object element is filled')
  assert.deepStrictEqual(Object.keys(d[1]), ['0'], 'module: an array element is not')
}
console.log(`ok: defaults stay off arrays, ${n} runs across paths and engines`)
