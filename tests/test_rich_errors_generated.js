'use strict'

// Once a validator's errors are being read with richErrors on, the combined
// function builds each error in its enriched shape where it happens (makeRich
// in lib/enrich-site.js, sites from errPushC in lib/js-compiler.js) instead
// of building the plain error and enriching it on read. The two must give the
// same output byte for byte. This compares them two ways over the suite and
// over random schemas and documents: the rich function's errors against the
// plain function's errors run through enrich(), and through the public API,
// the first read (the enrich path) against later reads (the generated path).
// It counts the results that came from the generated path, so it cannot pass
// by never reaching it.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { Validator } = require('..')
const jc = require('../lib/js-compiler')
const { enrich } = require('../lib/enrich-error')

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', draft7: 'http://json-schema.org/draft-07/schema#' }
const json = (x) => JSON.stringify(x)

let direct = 0
function compareDirect (schema, docs, where) {
  let plain, rich
  try {
    plain = jc.compileToJSCombined(schema, { valid: true }, null, null, { runtimeShape: true })
    rich = jc.compileToJSCombined(schema, { valid: true }, null, null, { runtimeShape: true, rich: true })
  } catch { return }
  if (!plain || !rich) return
  for (const d of docs) {
    let a, b
    try { a = plain(d); b = rich(d) } catch { continue }
    assert.strictEqual(a.valid, b.valid, `${where}: verdicts differ on ${json(d)}`)
    if (a.valid) continue
    direct++
    assert.strictEqual(json(b.errors), json(a.errors.map((e) => enrich(e, { data: d }))), `${where}: ${json(schema)} on ${json(d)}`)
  }
}

let viaApi = 0
function compareApi (schema, docs, where) {
  let v
  try { v = new Validator(schema) } catch { return }
  for (const d of docs) {
    let first, later, r
    try {
      first = json(v.validate(d))
      r = v.validate(d)
      later = json(r)
    } catch { continue }
    assert.strictEqual(later, first, `${where}: the read path changed the errors for ${json(schema)} on ${json(d)}`)
    if (!r.valid && r._build && r._build.final === true) viaApi++
  }
}

// The suite.
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite', 'tests', dialect)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      const schema = g.schema && typeof g.schema === 'object' ? { ...g.schema, $schema: uri } : g.schema
      const docs = g.tests.map((t) => t.data)
      compareDirect(schema, docs, `${dialect}/${f}`)
      compareApi(schema, docs, `${dialect}/${f}`)
    }
  }
}

// Random schemas over what the combined generator compiles, with keys that
// need escaping, nested arrays for paths built at run time, and the keywords
// that carry suggestions (enum, required, additionalProperties).
let seed = Number(process.env.SEED) || 1337
const rnd = (k) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % k }
const pick = (a) => a[rnd(a.length)]
const NAMES = ['name', 'nmae', 'id', 'x/y', 'k~1', 'q"t', 'emial', 'email']
function leaf () {
  return pick([
    { type: 'string', minLength: 2, maxLength: 5 }, { type: 'integer', minimum: 3, maximum: 9 }, { type: 'number', multipleOf: 2 },
    { enum: ['red', 'green', 'blue'] }, { enum: [1, 'a', null, { k: 1 }] }, { const: { a: [1, 2] } }, { const: 'fixed' },
    { type: 'string', format: 'email' }, { type: 'string', format: 'date' }, { type: 'string', pattern: '^[a-z]+$' },
    { type: ['string', 'null'] }, { not: { type: 'string' } }, true, false, { exclusiveMinimum: 0, exclusiveMaximum: 10 },
  ])
}
function node (depth) {
  const r = rnd(10)
  if (depth > 2 || r < 3) return leaf()
  if (r < 6) {
    const properties = {}
    for (let i = 0, n = 1 + rnd(3); i < n; i++) properties[pick(NAMES)] = node(depth + 1)
    const o = { type: 'object', properties }
    if (rnd(2)) o.required = [pick(NAMES), pick(NAMES)]
    if (rnd(3) === 0) o.additionalProperties = false
    if (rnd(5) === 0) o.dependentRequired = { [pick(NAMES)]: [pick(NAMES)] }
    if (rnd(6) === 0) o.propertyNames = { maxLength: 4 }
    if (rnd(6) === 0) o.minProperties = 2
    if (rnd(6) === 0) o.patternProperties = { '^x': { type: 'integer' } }
    return o
  }
  if (r < 8) {
    const a = { type: 'array', items: node(depth + 1) }
    if (rnd(2)) a.maxItems = 3
    if (rnd(3) === 0) a.uniqueItems = true
    if (rnd(4) === 0) a.contains = leaf()
    if (rnd(4) === 0) a.prefixItems = [leaf()]
    return a
  }
  if (r < 9) return { allOf: [node(depth + 1), node(depth + 1)] }
  return { if: { properties: { id: { type: 'integer' } } }, then: { required: ['name'] }, else: node(depth + 1) }
}
function value (depth) {
  const r = rnd(12)
  if (depth > 3 || r < 5) return pick(['', 'ab', 'abcdefgh', 'Red', 'not an email', 'a@b.co', '2026-13-45', 0, -1, 4, 7.5, 12, true, null, 'x'.repeat(80)])
  if (r < 9) {
    const o = {}
    for (let i = 0, n = rnd(4); i < n; i++) o[pick(NAMES.concat(['xa', 'extra']))] = value(depth + 1)
    return o
  }
  const a = []
  for (let i = 0, n = rnd(5); i < n; i++) a.push(value(depth + 1))
  return a
}
for (let i = 0; i < 1500; i++) {
  const schema = node(0)
  const docs = []
  for (let k = 0; k < 8; k++) docs.push(value(0))
  compareDirect(schema, docs, `random #${i}`)
  compareApi(schema, docs, `random #${i}`)
}

assert.ok(direct >= 6000, `too few rejections compared directly: ${direct}`)
assert.ok(viaApi >= 3000, `too few results came from the generated rich path: ${viaApi}`)
console.log(`ok: errors built enriched where they happen match enrich() (${direct} rejections compared directly, ${viaApi} read through the generated path)`)
