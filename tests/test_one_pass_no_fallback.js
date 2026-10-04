'use strict'

// Once a validator's errors are being read, validate() is the combined
// function in its result shape, with a try/catch that answers from the
// previous path if it throws. That keeps a thrown error from reaching the
// caller, and it also hides one: a body that throws on every call still gives
// the right answer, at the cost of an exception per call: a variable missing
// from the branch functions once made a variant four times slower without
// failing a test. This counts the fallbacks over the suite and requires none.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const jc = require('../lib/js-compiler')
const { Validator } = require('..')

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', draft7: 'http://json-schema.org/draft-07/schema#' }
class R { constructor (e) { this.valid = false; this.errors = e } }
let fallbacks = 0, built = 0, calls = 0
const where = []
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite', 'tests', dialect)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      const schema = g.schema && typeof g.schema === 'object' ? { ...g.schema, $schema: uri } : g.schema
      let v
      try { v = new Validator(schema); v.validate(null) } catch { continue }
      if (v.engine() !== 'codegen') continue
      {
        let fn
        const fallback = () => { fallbacks++; if (where.length < 5) where.push(`${dialect}/${f} :: ${g.description} `); return { valid: false } }
        try {
          fn = jc.compileToJSCombined(v._schemaObj, { valid: true }, null, null, { runtimeShape: true, resultShape: { Rejection: R, root: v._schemaObj, empty: [], sort: (x) => x, fallback, verdict: v._jsFn } })
        } catch { continue }
        if (!fn) continue
        built++
        for (const t of g.tests) { calls++; fn(t.data) }
      }
    }
  }
}
assert.ok(built >= 400, `too few one-pass functions built: ${built}`)
assert.strictEqual(fallbacks, 0, `${fallbacks} calls fell back, e.g. ${where.join('; ')}`)
console.log(`ok: one-pass validation never fell back (${built} functions, ${calls} calls)`)
