'use strict'

// The 2.0 Validator (lib/validator-small.js) answers with the small engine
// alone unless an entry's class carries the verdict core as `core`
// (lib/core/feature.js, as index.v2.edge.mjs does). Both must give the same
// answers: on every schema of the official suite and every document, the
// verdict, validate()'s verdict and its errors, with isValidObject or
// validate called first, and with abortEarly.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const small = require('../lib/validator-small.js')
const feature = require('../lib/core/feature.js')
// The core, counting the engines it builds, so the test knows it ran.
let built = 0
const core = (schema, args) => { if (args !== undefined) built++; return feature(schema, args) }
const F = require('../lib/features/error-messages.js')
const M = require('../lib/features/metaschemas.js')
const { Validator } = small
for (const m of [F, M]) for (const k of Object.keys(m)) try { Validator.use(m[k]) } catch {}
class Edge extends Validator {}
Edge.prototype.core = core

assert.strictEqual(new Validator({}).core, undefined, 'the small engine is the default')

const clone = (x) => x === undefined ? x : structuredClone(x)
const shape = (r) => JSON.stringify({ valid: r.valid, errors: r.valid ? [] : r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath, e.message]) })
// Each answer for a document, from a Validator built and first called under
// the given engine; null where the Validator refuses the schema.
function answers (schema, docs, opts, withCore, validateFirst) {
  try {
    const v = withCore ? new Edge(schema, opts) : new Validator(schema, opts)
    const out = []
    for (const d of docs) {
      if (validateFirst) { out.push(shape(v.validate(clone(d)))); out.push(v.isValidObject(clone(d))) } else { out.push(v.isValidObject(clone(d))); out.push(shape(v.validate(clone(d)))) }
    }
    return out
  } catch (e) {
    if (/^ata2:/.test(e.message)) return null
    if (e instanceof TypeError && SHAPE.test(e.message)) return e.message
    throw e
  }
}
// An enum or required that is not a list: both engines throw this TypeError.
const SHAPE = /^invalid schema: "(enum|required)" must be an array$/

let schemas = 0, docs = 0, refused = 0, runs = 0, shaped = 0
const SUITE = path.join(__dirname, 'suite/tests')
for (const dialect of fs.readdirSync(SUITE)) {
  for (const sub of ['', 'optional']) {
    const dir = path.join(SUITE, dialect, sub)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        const label = `${dialect}/${sub}/${f}: ${g.description}`
        const ds = g.tests.map((t) => t.data)
        for (const opts of [undefined, { abortEarly: true }]) {
          for (const validateFirst of [false, true]) {
            const want = answers(g.schema, ds, opts, false, validateFirst)
            const got = answers(g.schema, ds, opts, true, validateFirst)
            if (typeof got === 'string') shaped++
            assert.deepStrictEqual(got, want, label + (opts ? ' (abortEarly)' : '') + (validateFirst ? ', validate first' : ''))
            if (want === null) refused++; else runs++
          }
        }
        schemas++
        docs += ds.length
      }
    }
  }
}

assert.ok(built >= runs, `the core built ${built} engines for ${runs} Validators`)
console.log(`test_validator_small_core: ok, ${schemas} schemas and ${docs} documents answered the same with and without the core (${refused} refused by both, ${shaped} runs on a schema with an enum or required that is not a list, thrown by both)`)
