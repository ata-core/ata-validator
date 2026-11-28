'use strict'

// anyOf and oneOf ask their branches for a verdict before their errors only
// while that pays: after four misses in a row a node stops asking, until a
// branch passes (Plan.bva / bvo in lib/interpreter-core.js, bv in
// lib/plan-compiler.js). Asking is only a shortcut, so the answers must not
// depend on which way a node is set. For every group of the official suite
// with an anyOf or a oneOf, on the interpreted engine: a validator whose
// nodes have been turned off by repeated failures, then every document of the
// group, against a fresh validator per document; once on the walk and once
// on the closure tree it hands over to after its first thousand calls.

const assert = require('node:assert')
const { Validator } = require('..')
const suite = require('./suite-loader')

const dirs = ['draft2020-12', 'draft2019-09', 'draft7', 'draft6', 'draft4']
const show = (r) => JSON.stringify(r, (k, v) => (v === undefined ? '\u0000u' : v))
let groups = 0, answers = 0, turnedOff = 0
for (const d of dirs) {
  const files = suite.files(d).concat(suite.files(d, { dir: 'optional' }))
  for (const { file, cases } of files) {
    for (const g of cases) {
      const text = JSON.stringify(g.schema)
      if (!/"(anyOf|oneOf)"/.test(text)) continue
      const bad = g.tests.filter((t) => !t.valid).map((t) => t.data)
      if (!bad.length) continue
      let fresh
      try { fresh = g.tests.map((t) => show(new Validator(g.schema, { engine: 'interpreter' }).validate(structuredClone(t.data)))) } catch { continue }
      groups++
      for (const calls of [0, 1100]) {
        const v = new Validator(g.schema, { engine: 'interpreter' })
        // Onto the tree first where asked, with documents that fail.
        // Errors are built when read, so each failure is read.
        for (let i = 0; i < calls; i++) v.validate(structuredClone(bad[i % bad.length])).errors.length
        for (let i = 0; i < 6; i++) for (const b of bad) v.validate(structuredClone(b)).errors.length
        turnedOff++
        g.tests.forEach((t, i) => {
          assert.strictEqual(show(v.validate(structuredClone(t.data))), fresh[i], `${file} / ${g.description} / ${t.description}, after ${calls} calls`)
          assert.strictEqual(v.isValidObject(structuredClone(t.data)), JSON.parse(fresh[i]).valid)
          answers++
        })
        // And back: every document again, now in the order the suite gives.
        g.tests.forEach((t, i) => { assert.strictEqual(show(v.validate(structuredClone(t.data))), fresh[i]); answers++ })
      }
    }
  }
}
assert.ok(groups >= 110, `only ${groups} groups with anyOf or oneOf and a failing document`)
console.log(`ok: anyOf and oneOf answer the same whether they ask their branches first or not, ${groups} suite groups, ${answers} answers`)
