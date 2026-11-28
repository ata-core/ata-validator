'use strict'

// v1 `time` does not take a leap second. The v1 validation specification
// reads: "valid representation according to the full-time ABNF rule in RFC
// 3339. This MUST NOT include leap seconds", because a time with no date
// cannot name the moment a leap second belongs to. 2020-12 and earlier keep
// RFC 3339's leap second at 23:59:60 UTC. `date-time` keeps it under every
// dialect.
//
// ata asserts format by default, so a v1 schema with `format: "time"`
// accepted "23:59:60Z", which v1 rejects. Checked here on every entry point,
// at the first call and past the tiers, with the format under a property,
// behind $ref, in a document given through `schemas`, in propertyNames and
// under `not`.

const assert = require('node:assert')
const { Validator } = require('..')

const V1 = 'https://json-schema.org/v1'
const D2020 = 'https://json-schema.org/draft/2020-12/schema'
const LEAP = ['23:59:60Z', '01:29:60+01:30', '15:59:60-08:00']
const PLAIN = ['23:59:59Z', '12:00:00+01:00']

let checks = 0

function entryPoints (v, doc) {
  const text = JSON.stringify(doc)
  const out = [
    ['validate', v.validate(doc).valid],
    ['isValidObject', v.isValidObject(doc)],
    ['validateJSON', v.validateJSON(text).valid],
    ['isValidJSON', v.isValidJSON(text)],
  ]
  // Without the addon the buffer APIs answer through validate().
  out.push(['isValid(buffer)', v.isValid(Buffer.from(text))])
  return out
}

// Each entry point as the first call a fresh validator gets. The schema text
// is made unique per validator (a title), so the compile cache cannot answer
// with a validator another entry point already built: isValidObject() as the
// first call once took tier 0 and then generated code, both 2020-12 rules.
let uniq = 0
const ENTRIES = [
  ['validate', (v, d) => v.validate(d).valid],
  ['isValidObject', (v, d) => v.isValidObject(d)],
  ['validateJSON', (v, d) => v.validateJSON(JSON.stringify(d)).valid],
  ['isValidJSON', (v, d) => v.isValidJSON(JSON.stringify(d))],
]
function firstCalls (label, schema, doc, want, opts) {
  if (typeof schema !== 'object') return
  for (const [entry, call] of ENTRIES) {
    for (const warm of [0, 70, 1200]) {
      const v = new Validator({ ...schema, title: 'first-call ' + uniq++ }, opts)
      // Warmed with the document's own kind, so the warm-up does not compile
      // the validator through another path first.
      for (let i = 0; i < warm; i++) call(v, doc)
      assert.strictEqual(call(v, doc), want, `${label}, ${entry} as the first call, after ${warm} of its own: ${JSON.stringify(doc)}`)
      checks++
    }
  }
}

// One validator per call count, so each count is the validator's first look
// at the document after that many others.
function expect (label, schema, doc, want, opts) {
  firstCalls(label, schema, doc, want, opts)
  for (const warm of [0, 100, 1200]) {
    const v = new Validator(schema, opts)
    for (let i = 0; i < warm; i++) v.isValidObject(i % 2 ? {} : [])
    for (const [entry, got] of entryPoints(v, doc)) {
      assert.strictEqual(got, want, `${label}, ${entry} after ${warm} calls: ${JSON.stringify(doc)}`)
      checks++
    }
  }
}

const shapes = (dialect, t) => [
  ['root', { $schema: dialect, format: 'time' }, t],
  ['property', { $schema: dialect, type: 'object', properties: { at: { type: 'string', format: 'time' } } }, { at: t }],
  ['behind $ref', { $schema: dialect, $defs: { t: { format: 'time' } }, properties: { at: { $ref: '#/$defs/t' } } }, { at: t }],
  ['propertyNames', { $schema: dialect, propertyNames: { format: 'time' } }, { [t]: 1 }],
]

for (const t of LEAP) {
  for (const [where, schema, doc] of shapes(V1, t)) expect(`v1 ${where}`, schema, doc, false)
  // Under `not` the wrong verdict flips: a leap second must make it pass.
  expect('v1 under not', { $schema: V1, not: { format: 'time' } }, t, true)
  // A document given through `schemas`, reached from a v1 root.
  expect('v1 schemas document', { $schema: V1, properties: { at: { $ref: 'https://example.com/t' } } }, { at: t }, false,
    { schemas: { 'https://example.com/t': { $schema: V1, format: 'time' } } })
  // Removal fused into the verdict, and a const/enum the JSON-text scanner
  // hands to a compiled delegate: both are built without the root's dialect.
  expect('v1 removeAdditional', { $schema: V1, type: 'object', properties: { at: { type: 'string', format: 'time' } }, additionalProperties: false }, { at: t }, false, { removeAdditional: true })
  expect('v1 enum delegate', { $schema: V1, enum: [{ at: t }, { b: 1 }], properties: { at: { format: 'time' } } }, { at: t }, false)
  // 2020-12 keeps the leap second.
  for (const [where, schema, doc] of shapes(D2020, t)) expect(`2020-12 ${where}`, schema, doc, true)
  // Format as an annotation: nothing is asserted under either dialect.
  expect('v1 assertFormat false', { $schema: V1, format: 'time' }, t, true, { assertFormat: false })
  // A caller's own `time` wins over the built-in one.
  expect('v1 user format', { $schema: V1, format: 'time' }, t, true, { formats: { time: () => true } })
  // date-time keeps the leap second in v1.
  expect('v1 date-time', { $schema: V1, format: 'date-time' }, '1998-12-31T' + t, true)
}
for (const t of PLAIN) for (const [where, schema, doc] of shapes(V1, t)) expect(`v1 ${where}`, schema, doc, true)

;(async () => {
  // ata-validator/ir either answers as v1 does or declines the schema.
  const ir = await import('../lib/ir/index.mjs')
  for (const t of LEAP) {
    for (const [where, schema, doc] of shapes(V1, t)) {
      let c = null
      try { c = ir.compileClosures(schema, {}) } catch (e) { if (!/^ir: /.test(e.message)) throw e }
      if (c !== null) { assert.strictEqual(c.validate(doc).valid, false, `ir closures, v1 ${where}: ${t}`); checks++ }
    }
  }
  console.log(`ok: v1 time takes no leap second, 2020-12 still does, ${checks} checks`)
})().catch((e) => { console.error(e); process.exit(1) })
