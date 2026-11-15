'use strict'

// abortEarly is a documented contract, not a property of whichever engine
// answers: every rejection is the frozen ATA9000 stub and the verdict is the
// Validator's own. A schema with a dynamic reference ($dynamicRef, or a
// 2019-09 $recursiveRef, which is read as one) that the generators did not
// unroll went to the interpreted engine without it, and handed out the full
// error list (25 of the suites' rejections did). Every 2020-12, 2019-09
// and draft-07 suite group is checked with the default engine and with
// engine: 'interpreter', with and without a defaults pass.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { Validator } = require('..')

const root = path.join(__dirname, 'suite', 'tests')
let rejected = 0
const bad = []
for (const d of ['draft2020-12', 'draft2019-09', 'draft7']) {
  for (const f of fs.readdirSync(path.join(root, d)).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(root, d, f), 'utf8'))) {
      for (const extra of [{}, { engine: 'interpreter' }, { useDefaults: false }]) {
        let ref, v
        try { ref = new Validator(g.schema, extra); v = new Validator(g.schema, { ...extra, abortEarly: true }) } catch { continue }
        for (const t of g.tests) {
          let want, got
          try { want = ref.validate(structuredClone(t.data)).valid } catch { continue }
          got = v.validate(structuredClone(t.data))
          if (got.valid !== want) { bad.push(`${d}/${f}: ${g.description}: verdict ${got.valid}, expected ${want}`); continue }
          if (!got.valid) {
            rejected++
            if (got.errors.length !== 1 || got.errors[0].code !== 'ATA9000') bad.push(`${d}/${f}: ${g.description} ${JSON.stringify(extra)}: ${got.errors.length} errors, first ${got.errors[0] && got.errors[0].code}`)
          }
        }
      }
    }
  }
}
assert.deepStrictEqual(bad.slice(0, 5), [], `${bad.length} answers break the abortEarly contract`)
assert.ok(rejected > 3000, 'the suite ran: ' + rejected)
console.log('ok: abortEarly gives the ATA9000 stub on all', rejected, 'rejections, with the Validator\'s verdicts')
