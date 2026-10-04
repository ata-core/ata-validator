'use strict'

// Reading errors takes one of two paths. validate() answers from the verdict
// and builds the errors on read; with richErrors on, from a validator's third
// read on they are built enriched where they fail by the rich combined
// function (see makeRich) instead of plain and enriched afterwards. Shared
// error literals are copied on the way out, picked by a non-enumerable marker
// rather than Object.isFrozen. None of that may change what a caller sees:
// this compares the first read with later reads on every suite schema, in
// both error shapes, and checks every error handed out is the caller's own
// object. It counts how many validators actually switched, so it cannot pass
// by never reaching the second path.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { Validator } = require('..')

const view = (r) => JSON.stringify({ valid: r.valid, errors: r.valid ? [] : r.errors, raw: r.valid ? null : r._ataRaw(), json: r })

let switched = 0, compared = 0, ownObjects = 0
for (const dialect of ['draft2020-12', 'draft7']) {
  const dir = path.join(__dirname, 'suite', 'tests', dialect)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f)))) {
      for (const richErrors of [true, false]) {
        let v
        try { v = new Validator(g.schema, { richErrors }) } catch { continue }
        for (const t of g.tests) {
          let first, later
          try {
            first = view(v.validate(t.data))
            v.validate(t.data).errors
            const second = v.validate(t.data)
            later = view(second)
            if (second._build && second._build.final === true) switched++
            assert.strictEqual(view(v.validate(t.data)), later)
          } catch (e) {
            if (e instanceof assert.AssertionError) throw e
            continue
          }
          compared++
          assert.strictEqual(later, first, `${dialect}/${f} "${g.description}" / "${t.description}" (richErrors ${richErrors}): the read path changed the result`)
          const r = v.validate(t.data)
          if (!r.valid) {
            for (const e of r.errors) {
              assert.ok(!Object.isFrozen(e), `${dialect}/${f}: an error was handed out frozen`)
              e.message = 'edited'
              assert.strictEqual(e.message, 'edited')
              ownObjects++
            }
            // An edit to one result does not reach the next.
            const again = v.validate(t.data)
            for (const e of again.errors) assert.notStrictEqual(e.message, 'edited', `${dialect}/${f}: an edited error leaked into the next result`)
          }
        }
      }
    }
  }
}

assert.ok(compared >= 4000, `too few comparisons: ${compared}`)
assert.ok(switched >= 500, `too few results came from the rich generated path: ${switched}`)
assert.ok(ownObjects >= 2000, `too few errors checked for ownership: ${ownObjects}`)
console.log(`ok: both read paths give the same result (${compared} comparisons, ${switched} from the rich generated path, ${ownObjects} errors checked as the caller's own)`)
