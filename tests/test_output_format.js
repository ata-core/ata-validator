'use strict'

// The official suite ships tests for the specification's own output format
// under `tests/suite/output-tests/`, separate from the validation tests. They
// check what a validator reports, not what it decides: the JSON Pointers in
// `keywordLocation` and `instanceLocation`, and which annotations survive.
//
// Nothing here ran them before. The first case in the 2020-12 set is a
// property key `~a/b` that has to come back as `/~0a~1b`, which is the bug
// this repo fixed by hand the same week it wired this file up. The suite had
// the test all along.
//
// Each case carries a schema that the produced output must satisfy, so the
// check is a validation of ata's output by ata, against a schema written by
// the specification. The output schema for the release is registered first,
// since the cases $ref it by URI.

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')
const { Validator } = require('..')
const { toOutput } = require('../lib/output-format')

const SUITE = path.join(__dirname, 'suite', 'output-tests')

// `basic` is defined for these two. The v1 `list` format is deliberately not
// run: it is still changing, and v1's own output schema does not define `list`
// yet, so there is nothing stable to hold an implementation to.
const DIALECTS = ['draft2019-09', 'draft2020-12']

if (!fs.existsSync(SUITE)) {
  console.log('output format: suite not checked out, skipped')
  process.exit(0)
}

let passed = 0
const failures = []

for (const dialect of DIALECTS) {
  const dir = path.join(SUITE, dialect, 'content')
  if (!fs.existsSync(dir)) continue

  const outputSchema = JSON.parse(fs.readFileSync(path.join(SUITE, dialect, 'output-schema.json'), 'utf8'))
  const registry = { [outputSchema.$id]: outputSchema }

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      for (const test of group.tests) {
        const where = `${dialect}/${file} :: ${group.description} :: ${test.description}`
        const expected = test.output && test.output.basic
        if (!expected) continue
        let produced
        try {
          produced = toOutput(new Validator(group.schema), test.data, { format: 'basic' })
        } catch (e) {
          failures.push(`${where}\n    producing output threw: ${e.message}`)
          continue
        }
        let verdict
        try {
          verdict = new Validator(expected, { schemas: registry }).validate(produced)
        } catch (e) {
          failures.push(`${where}\n    checking output threw: ${e.message}`)
          continue
        }
        if (verdict.valid) {
          passed++
        } else {
          failures.push(
            `${where}\n    produced: ${JSON.stringify(produced)}\n    ` +
            verdict.errors.map((e) => `${e.keyword} at ${e.instancePath || '/'}: ${e.message}`).join('\n    '),
          )
        }
      }
    }
  }
}

const total = passed + failures.length
if (failures.length) {
  console.error(`FAIL output format: ${passed} of ${total} cases produce conforming output\n`)
  for (const f of failures) console.error('  ' + f + '\n')
  process.exit(1)
}

assert.ok(total > 0, 'no output tests were found to run')
console.log(`output format: ${passed} of ${total} suite output cases produce conforming basic output`)
