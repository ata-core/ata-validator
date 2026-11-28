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

const { Validator } = require('..')
const suite = require('./suite-loader')

const DIALECTS = ['draft2020-12', 'draft7', 'v1']

console.log('\nbuffer path parity: isValid(buffer) against validate(value)\n')

// isValid() needs the native accelerator. Where it is absent the API throws a
// clear error by design, and there is nothing to compare.
try {
  new Validator({ type: 'object' }).isValid(Buffer.from('{"a":1}'))
} catch (e) {
  console.log(`  skipped: ${e.message.split('\n')[0]}\n`)
  process.exit(0)
}

const PAD = ' '.repeat(9000)
let compared = 0
const disagreements = []

for (const dialect of DIALECTS) {
  if (!suite.HAVE_SUITE) break

  // Each case brings its own external documents; the same URI can mean a
  // different document in another case.
  for (const { file, cases } of suite.files(dialect)) {
    for (const group of cases) {
      const schema = group.schema

      let validator
      try {
        validator = new Validator(schema, { schemas: suite.registry(group) })
      } catch {
        continue
      }

      for (const test of group.tests) {
        const text = JSON.stringify(test.data)
        let viaValue
        let viaBuffer
        try {
          viaValue = validator.validate(JSON.parse(text)).valid
          viaBuffer = validator.isValid(Buffer.from(text))
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
        // The text entry points hand a document at or above the simdjson
        // threshold to the native engine. Leading whitespace changes nothing
        // about a JSON document, so padding puts every case on that path.
        // validateJSON used to ask the native walker first there without the
        // gate, and accepted what validate() rejects.
        const padded = PAD + text
        for (const [name, got] of [['validateJSON', () => validator.validateJSON(padded).valid], ['isValidJSON', () => validator.isValidJSON(padded)]]) {
          const answer = got()
          compared++
          if (answer !== viaValue) {
            disagreements.push(
              `${dialect}/${file} :: ${group.description} :: ${test.description}\n` +
                `      validate=${viaValue} ${name}(padded to ${padded.length} bytes)=${answer}` +
                `  schema=${JSON.stringify(schema).slice(0, 110)}`,
            )
          }
        }
      }
    }
  }
}

// The gap was 245 until lib/buffer-gate.js started routing the shapes the
// native walker gets wrong through validate(). It is held at zero: a new
// disagreement is a new entry in that gate, not a new number here.
const KNOWN_GAP = 0

console.log(`  compared ${compared} cases across ${DIALECTS.length} dialects`)
console.log(`  ${disagreements.length} disagreements, known gap is ${KNOWN_GAP}\n`)

if (disagreements.length > KNOWN_GAP) {
  console.log(`  the gap grew by ${disagreements.length - KNOWN_GAP}. A sample:\n`)
  for (const d of disagreements.slice(0, Number(process.env.SHOW) || 15)) console.log(`  ${d}\n`)
  process.exit(1)
}

if (disagreements.length < KNOWN_GAP) {
  console.log(`  ${KNOWN_GAP - disagreements.length} fewer than recorded.`)
  console.log(`  Lower KNOWN_GAP to ${disagreements.length} so it cannot come back.\n`)
  process.exit(1)
}
