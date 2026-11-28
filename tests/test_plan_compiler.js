'use strict'

// The closure-tree compiler must be invisible: for every schema it accepts,
// its verdicts and its error output are byte-for-byte what eval() produces.
// This diffs the two over the official suite, three dialects, both
// directions, plus the verdict-only mode.

const assert = require('assert')
const { createInterpreter } = require('../lib/interpreter')
const suite = require('./suite-loader')

const DIALECTS = { 'draft2020-12': false, draft7: false, v1: true }

let compiled = 0
let declined = 0
let cases = 0

// Each case brings its own external documents, addressable by their retrieval
// URI, so cross-document references compile and diff too. The registry is
// per case: the same URI can mean different documents in different cases.
for (const [dialect, v1] of Object.entries(DIALECTS)) {
  for (const { file, cases: groups } of suite.HAVE_SUITE ? suite.files(dialect) : []) {
    for (const group of groups) {
      const schemaMap = suite.registryMap(group)
      let fastI, evalI
      try {
        fastI = createInterpreter(group.schema, { v1, schemaMap })
        evalI = createInterpreter(group.schema, { v1, schemaMap })
      } catch { continue }
      evalI._fast = null // force the generic evaluator
      if (fastI._fastRoot() === null) { declined++; continue }
      compiled++
      for (const test of group.tests) {
        cases++
        const a = fastI.validate(test.data)
        const b = evalI.validate(test.data)
        const where = `${dialect}/${file} :: ${group.description} :: ${test.description}`
        assert.strictEqual(a.valid, b.valid, `verdict differs at ${where}`)
        assert.strictEqual(JSON.stringify(a.errors), JSON.stringify(b.errors), `errors differ at ${where}`)
        assert.strictEqual(fastI.isValid(test.data), b.valid, `isValid differs at ${where}`)
      }
    }
  }
}

console.log(`plan compiler agreement: ${compiled} schemas compiled, ${declined} declined, ${cases} cases identical`)
assert.ok(compiled > 200, 'expected the compiler to take a substantial share of the suite')
