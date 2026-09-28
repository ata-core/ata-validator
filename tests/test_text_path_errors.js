'use strict'

// validateJSON(text) must report what validate(JSON.parse(text)) reports: the
// same verdict and, field by field, the same errors. Every case of the
// official suite in three dialects goes through both, once as the text is and
// once padded with whitespace past the simdjson threshold, which changes
// nothing about the document and moves it onto the path a large request takes.
//
// Two differences this found, both fixed: the large path answered from the
// native addon's own validator, which accepted documents validate() rejects and
// worded errors its own way, and the text path took errors the generated code
// had stamped with a docUrl for enriched ones, so they came without `received`.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { Validator } = require('..')

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  v1: 'https://json-schema.org/v1',
}
const registry = {}
;(function collect (dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, prefix + e.name + '/')
    else if (e.name.endsWith('.json')) registry['http://localhost:1234/' + prefix + e.name] = JSON.parse(fs.readFileSync(full, 'utf8'))
  }
})(path.join(__dirname, 'suite/remotes'), '')

const PAD = ' '.repeat(9000)
const shape = (r) => r.valid ? 'valid' : r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath, e.message, e.received])

let compared = 0
const diffs = []
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite/tests', dialect)
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      const schema = typeof group.schema === 'object' && group.schema !== null && !('$schema' in group.schema)
        ? { ...group.schema, $schema: uri }
        : group.schema
      let v
      try { v = new Validator(schema, { schemas: registry }) } catch { continue }
      for (const t of group.tests) {
        const text = JSON.stringify(t.data)
        const want = JSON.stringify(shape(v.validate(JSON.parse(text))))
        for (const [how, input] of [['text', text], ['padded', PAD + text]]) {
          const got = JSON.stringify(shape(v.validateJSON(input)))
          compared++
          if (got !== want) diffs.push(`${dialect}/${file} :: ${group.description} :: ${t.description} (${how})\n    validate     ${want.slice(0, 300)}\n    validateJSON ${got.slice(0, 300)}`)
        }
      }
    }
  }
}

if (diffs.length) {
  console.log(`${diffs.length} of ${compared} differ. A sample:\n`)
  for (const d of diffs.slice(0, Number(process.env.SHOW) || 10)) console.log(d + '\n')
}
assert.strictEqual(diffs.length, 0, 'validateJSON and validate disagree')
assert.ok(compared > 6000, `compared ${compared}: too few`)
console.log(`ok: validateJSON reports what validate reports on ${compared} documents, plain and past the simdjson threshold`)
