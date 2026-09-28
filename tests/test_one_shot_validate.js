'use strict'

// The one-shot validate(schema, data) must answer exactly as a Validator
// does: the same verdict, `data` on success, errors with the same code,
// keyword and paths. Until 1.33.3 it handed the schema to the native engine
// whenever the addon was loaded and returned that engine's raw result, with
// numeric codes, `path` for `instancePath`, no keyword and no `data`, which a
// user found through the missing `data` (issue #49). This runs every case of
// the official suite through both, and a Validator instance through the
// one-shot form. Run it with the addon loaded, as npm test does in a checkout
// that has built it, since that is where the two used to part.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ata = require('..')
const { Validator, validate } = ata

const shape = (r) => JSON.stringify({
  valid: r.valid,
  hasData: r.valid ? 'data' in r : false,
  errors: (r.errors || []).map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath]),
})

const dir = path.join(__dirname, 'suite/tests/draft2020-12')
let compared = 0, bad = 0
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    let v
    try { v = new Validator(g.schema) } catch { continue }
    for (const t of g.tests) {
      const want = shape(v.validate(t.data))
      const got = shape(validate(g.schema, t.data))
      const viaInstance = shape(validate(v, t.data))
      compared++
      if (got !== want || viaInstance !== want) {
        if (bad++ < 5) console.error(`${f}: ${g.description} / ${t.description}\n  one-shot ${got}\n  Validator ${want}`)
      }
    }
  }
}

// The case from the issue, by name: data on success, typed errors on failure.
const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
const ok = validate(schema, { name: 'x' })
assert.strictEqual(ok.valid, true)
assert.deepStrictEqual(ok.data, { name: 'x' }, 'a valid result carries data')
const no = validate(schema, {})
assert.strictEqual(no.valid, false)
assert.strictEqual(no.errors[0].code, 'ATA7001')
assert.strictEqual(no.errors[0].keyword, 'required')
assert.strictEqual(no.errors[0].instancePath, '')
assert.strictEqual(validate(JSON.stringify(schema), { name: 'x' }).valid, true, 'a schema passed as a JSON string still works')

assert.strictEqual(bad, 0, `${bad} one-shot results differ from the Validator's`)
assert.ok(compared > 1200, `compared ${compared} results: too few`)
console.log(`ok: one-shot validate() matches the Validator on ${compared} suite cases${process.env.ATA_NO_NATIVE ? ' (native addon disabled)' : ''}`)
