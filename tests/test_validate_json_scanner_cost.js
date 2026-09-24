'use strict'

// validateJSON must not cost a multiple of isValidJSON to reach the same verdict.
//
// Both answer a question about the same text. isValidJSON asks the wire scanner,
// which reads the text once and allocates nothing. validateJSON, above the
// simdjson threshold, encoded the whole document to a Buffer and called the
// native validator: measured on a 149 KB config, 340 microseconds against the
// scanner's 191, with 16.8% of it in utf8Write, and the same against the
// published per-platform addon as against a local build. The scanner
// short-circuit was wired onto isValidJSON and onto validateJSON only under
// abortEarly.
//
// Both directions are gated here. Taking the scanner's "valid" answer is the win;
// taking its "invalid" answer has to go straight to the path that produces errors
// rather than adding a scan in front of the native attempt, or the invalid path
// pays for both.
//
// Budgets are ratios, so machine speed drops out. Measured before: valid 1.78x
// isValidJSON and invalid 2.41x JSON.parse.

const assert = require('node:assert')
const { Validator } = require('..')

const schema = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    sections: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                weight: { type: 'number', minimum: 0 },
                nested: { type: 'object', properties: { retries: { type: 'integer', maximum: 10 } } },
              },
            },
          },
        },
      },
    },
  },
}

function makeConfig (bad, tag) {
  const cfg = { version: bad ? 'nope' : '1.0.0', sections: {}, _t: tag }
  for (let s = 0; s < 20; s++) {
    const entries = []
    for (let i = 0; i < 60; i++) entries.push({ id: 'e' + i, weight: i, nested: { retries: 3 } })
    cfg.sections['s' + s] = { entries }
  }
  return cfg
}

const texts = [], badTexts = []
for (let i = 0; i < 40; i++) {
  texts.push(JSON.stringify(makeConfig(false, i), null, 2))
  badTexts.push(JSON.stringify(makeConfig(true, i), null, 2))
}

const v = new Validator(schema)

// Answers first, on fresh strings so nothing is memoised.
assert.strictEqual(v.validateJSON(texts[0]).valid, true, 'a valid config is valid')
assert.strictEqual(v.isValidJSON(texts[1]), true, 'and isValidJSON agrees')
{
  const r = v.validateJSON(badTexts[0])
  assert.strictEqual(r.valid, false, 'an invalid config is invalid')
  assert.strictEqual(r.errors.length, 1, `and still reports its error: ${JSON.stringify(r.errors)}`)
  assert.strictEqual(r.errors[0].instancePath, '/version')
  assert.strictEqual(r.errors[0].keyword, 'pattern')
  assert.ok(r.errors[0].dataFrame && r.errors[0].dataFrame.line === 2, 'and its source frame')
}
assert.strictEqual(v.isValidJSON(badTexts[1]), false, 'isValidJSON agrees on the invalid one')
// A broken document is a syntax error on both, not a throw.
{
  const r = v.validateJSON('{"version": ')
  assert.strictEqual(r.valid, false)
  assert.strictEqual(r.errors.length, 1, 'one error for a truncated document')
}
console.log('ok: verdicts, errors and frames hold on the text path')

const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
function med (fn, iters) {
  for (let i = 0; i < 20; i++) fn()
  const runs = []
  for (let r = 0; r < 9; r++) {
    const t = process.hrtime.bigint()
    for (let i = 0; i < iters; i++) fn()
    runs.push(Number(process.hrtime.bigint() - t) / 1e3 / iters)
  }
  return median(runs)
}

const N = 20
let i = 0
const scanT = [], validT = [], parseT = [], invalidT = []
for (let r = 0; r < 5; r++) {
  scanT.push(med(() => v.isValidJSON(texts[(i++) % 40]), N))
  validT.push(med(() => v.validateJSON(texts[(i++) % 40]).valid, N))
  parseT.push(med(() => JSON.parse(texts[(i++) % 40]), N))
  invalidT.push(med(() => v.validateJSON(badTexts[(i++) % 40]).valid, N))
}
const validRatio = median(validT) / median(scanT)
const invalidRatio = median(invalidT) / median(parseT)

const VALID_BUDGET = 1.35
const INVALID_BUDGET = 2.6
let failed = false
if (validRatio > VALID_BUDGET) {
  console.error(`FAIL validateJSON scanner cost: a valid document costs ${validRatio.toFixed(2)}x isValidJSON, over the ${VALID_BUDGET}x budget; the verdict is not coming from the scanner`)
  failed = true
}
if (invalidRatio > INVALID_BUDGET) {
  console.error(`FAIL validateJSON scanner cost: an invalid document costs ${invalidRatio.toFixed(2)}x JSON.parse, over the ${INVALID_BUDGET}x budget; the scan is being paid on top of the native attempt`)
  failed = true
}
if (failed) process.exit(1)
console.log(`validateJSON scanner cost: valid ${validRatio.toFixed(2)}x isValidJSON (budget ${VALID_BUDGET}), invalid ${invalidRatio.toFixed(2)}x JSON.parse (budget ${INVALID_BUDGET})`)
