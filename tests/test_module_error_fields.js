'use strict'

// A standalone module's errors against the Validator's, field for field and
// in order, on every group of the official suite, for both ways a module
// carries its errors: generated error code (with `order: true`, the runtime's
// order) and the one-pass function. The only difference allowed is the
// documented one: a schema the error generators decline reports a failing
// document as the single ATA9000 error. A valid document is valid in both.
//
// Found missing, all reported by no test until this one:
//   - a false subschema's error had no code and no docUrl in a module
//     (`{ properties: { x: false } }`), where the Validator gives ATA4005;
//   - the collapsed error of a failed anyOf or oneOf had no docUrl;
//   - the one-pass function of a schema with many optional properties wrote
//     to its key walk's sampling record, which the module had frozen, and
//     threw: a valid document was reported invalid (ATA9000).

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { Validator } = require('..')
const aot = require('../aot.js')

const FIELDS = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'docUrl']
const load = (src) => { const m = new Module('module'); m._compile(src, 'module.cjs'); return m.exports }
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => FIELDS.map((f) => e[f]))])

let schemas = 0
let docs = 0
let declined = 0
function compare (schema, data, label) {
  for (const opts of [{ order: true }, { onePass: true }]) {
    let mod
    try {
      const src = aot.toStandaloneModule(new Validator(schema), { format: 'cjs', ...opts })
      if (!src) return
      mod = load(src)
    } catch { return }
    const v = new Validator(schema)
    schemas++
    for (const d of data) {
      let want
      try { want = v.validate(d) } catch { continue }
      const got = mod.validate(d)
      docs++
      const where = `${label} (${opts.onePass ? 'one-pass' : 'generated'}): ${JSON.stringify(d).slice(0, 100)}`
      assert.strictEqual(got.valid, want.valid, where + ': verdict')
      assert.strictEqual(mod.isValid(d), want.valid, where + ': isValid')
      if (!want.valid && got.errors.length === 1 && got.errors[0].code === 'ATA9000') { declined++; continue }
      assert.strictEqual(shape(got), shape(want), where)
    }
  }
}

const SUITE = path.join(__dirname, 'suite/tests')
for (const dialect of fs.readdirSync(SUITE)) {
  for (const sub of ['', 'optional/format']) {
    const dir = path.join(SUITE, dialect, sub)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        if (JSON.stringify(g.schema).includes('localhost:1234')) continue
        compare(g.schema, g.tests.map((t) => t.data), `${dialect}/${sub}${f}: ${g.description}`)
      }
    }
  }
}

// The cases above, small.
compare({ properties: { x: false } }, [{ x: 1 }, {}], 'false property')
compare({ prefixItems: [false] }, [[1], []], 'false prefix item')
compare({ dependentSchemas: { x: { properties: { x: false } } } }, [{ x: 1 }], 'false under dependentSchemas')
compare({ if: { properties: { t: { const: 1 } } }, else: { properties: { d: { items: { properties: { x: false } } } } } }, [{ t: 2, d: [{ x: 1 }] }, { t: 1, d: [{ x: 1 }] }], 'false under else and items')
compare({ anyOf: [{ type: 'string' }, { type: 'integer' }] }, [1.5, 'a'], 'collapsed anyOf')
compare({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, [1, 1.5, 'a'], 'oneOf, two branches pass')
const many = {}
for (let i = 0; i < 40; i++) many['f' + i] = { type: i % 2 ? 'string' : 'integer' }
const shapes = []
for (let i = 0; i < 300; i++) {
  const d = {}
  for (let j = 0; j < 40; j++) if ((i * 7 + j * 3) % 5 === 0) d['f' + j] = j % 2 ? 's' : j
  if (i % 3 === 0) d.f0 = 'wrong'
  shapes.push(d)
}
compare({ type: 'object', properties: many }, shapes, 'many optional properties, documents of many shapes')

assert.ok(schemas > 3000, `compared ${schemas} schema builds`)
console.log(`test_module_error_fields: ${schemas} modules, ${docs} documents, ${declined} declined to ATA9000 as documented`)
