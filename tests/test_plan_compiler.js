'use strict'

// The closure-tree compiler must be invisible: for every schema it accepts,
// its verdicts and its error output are byte-for-byte what eval() produces.
// This diffs the two over the official suite, three dialects, both
// directions, plus the verdict-only mode.

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { createInterpreter } = require('../lib/interpreter')

const DIALECTS = { 'draft2020-12': false, draft7: false, v1: true }

// The suite's remote documents, addressable by their retrieval URI, so
// cross-document references compile and diff too.
const remotes = new Map()
;(function collect(dir, prefix) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, prefix + entry.name + '/')
    else if (entry.name.endsWith('.json')) {
      try { remotes.set('http://localhost:1234/' + prefix + entry.name, JSON.parse(fs.readFileSync(full, 'utf8'))) } catch {}
    }
  }
})(path.join(__dirname, 'suite/remotes'), '')

let compiled = 0
let declined = 0
let cases = 0

for (const [dialect, v1] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite/tests', dialect)
  if (!fs.existsSync(dir)) continue
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      const schemaMap = new Map(remotes)
      if (group.registry) for (const [id, sub] of Object.entries(group.registry)) schemaMap.set(id, sub)
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
