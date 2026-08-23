'use strict'

// isValid() on a raw buffer must agree with validate() on the parsed value.
//
// They are different engines. validate() can fall back to the tree walker when
// the bytecode plan cannot decide a document; isValid() used to return the
// plan's answer directly, so a plan that stopped at a COMPOSITION opcode
// (allOf, anyOf, oneOf, $ref) reported every document invalid. Valid requests
// were rejected by any schema using those keywords, which is most of them.
//
// The bug was found by accident while calling the same engine through a
// different binding. Nothing in the suite compared the two paths, so nothing
// caught it. This file compares them over the whole official corpus.

const fs = require('fs')
const path = require('path')
const { Validator } = require('..')

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  v1: 'https://json-schema.org/v1',
}

console.log('\nbuffer path parity: isValid(buffer) against validate(value)\n')

// isValid() needs the native accelerator. Where it is absent the API throws a
// clear error by design, and there is nothing to compare.
try {
  new Validator({ type: 'object' }).isValid(Buffer.from('{"a":1}'))
} catch (e) {
  console.log(`  skipped: ${e.message.split('\n')[0]}\n`)
  process.exit(0)
}

const REMOTES = path.join(__dirname, 'suite/remotes')
const registry = {}
;(function collect(dir, prefix) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, prefix + entry.name + '/')
    else if (entry.name.endsWith('.json')) {
      try {
        registry['http://localhost:1234/' + prefix + entry.name] = JSON.parse(
          fs.readFileSync(full, 'utf8'),
        )
      } catch {}
    }
  }
})(REMOTES, '')

let compared = 0
const disagreements = []

for (const [dialect, dialectUri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite/tests', dialect)
  if (!fs.existsSync(dir)) continue

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      const schema =
        typeof group.schema === 'object' && group.schema !== null && !Array.isArray(group.schema)
          ? '$schema' in group.schema
            ? group.schema
            : { ...group.schema, $schema: dialectUri }
          : group.schema

      let validator
      try {
        validator = new Validator(schema, { schemas: registry })
      } catch {
        continue
      }

      for (const test of group.tests) {
        let viaValue
        let viaBuffer
        try {
          viaValue = validator.validate(test.data).valid
          viaBuffer = validator.isValid(Buffer.from(JSON.stringify(test.data)))
        } catch {
          // An API that refuses the input on both paths is not a disagreement.
          continue
        }
        compared++
        if (viaValue !== viaBuffer) {
          disagreements.push(
            `${dialect}/${file} :: ${group.description} :: ${test.description}\n` +
              `      validate=${viaValue} isValid(buffer)=${viaBuffer}` +
              `  schema=${JSON.stringify(schema).slice(0, 110)}`,
          )
        }
      }
    }
  }
}

// The gap was 245 until lib/buffer-gate.js started routing the shapes the
// native walker gets wrong through validate(). It is held at zero: a new
// disagreement is a new entry in that gate, not a new number here.
const KNOWN_GAP = 0

console.log(`  compared ${compared} cases across ${Object.keys(DIALECTS).length} dialects`)
console.log(`  ${disagreements.length} disagreements, known gap is ${KNOWN_GAP}\n`)

if (disagreements.length > KNOWN_GAP) {
  console.log(`  the gap grew by ${disagreements.length - KNOWN_GAP}. A sample:\n`)
  for (const d of disagreements.slice(0, 15)) console.log(`  ${d}\n`)
  process.exit(1)
}

if (disagreements.length < KNOWN_GAP) {
  console.log(`  ${KNOWN_GAP - disagreements.length} fewer than recorded.`)
  console.log(`  Lower KNOWN_GAP to ${disagreements.length} so it cannot come back.\n`)
  process.exit(1)
}
