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

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1]
function time (fn, iters) {
  const t = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) fn()
  return Number(process.hrtime.bigint() - t) / iters
}

// The four timings are taken in short alternating blocks and each round gives
// its own ratios, so a runner that slows down for a stretch slows all four and
// the slowdown divides out; the median over rounds drops the rounds a pause
// landed in. Timed one after another, a slow stretch landed on one timing and
// moved the invalid ratio from 2.2x to 3.0x on the same code.
const N = 5
const ROUNDS = 25
let i = 0
const VALID_BUDGET = 1.35
// Measured this way an invalid document reads 2.0x to 2.1x on Node 24 and 25
// and 2.35x on Node 20; with the scan paid in front of the native attempt it
// reads 2.8x to 3.0x and 3.5x. The budget sits between the two.
const INVALID_BUDGET = 2.6
const scan = () => v.isValidJSON(texts[(i++) % 40])
const valid = () => v.validateJSON(texts[(i++) % 40]).valid
const parse = () => JSON.parse(texts[(i++) % 40])
const invalid = () => v.validateJSON(badTexts[(i++) % 40]).valid
for (let w = 0; w < 20; w++) { scan(); valid(); parse(); invalid() }
require('./_ratio_gate').ratioGate(() => {
  const validR = [], invalidR = []
  for (let r = 0; r < ROUNDS; r++) {
    const s = time(scan, N)
    const a = time(valid, N)
    const p = time(parse, N)
    const b = time(invalid, N)
    validR.push(a / s)
    invalidR.push(b / p)
  }
  const validRatio = median(validR)
  const invalidRatio = median(invalidR)
  const failures = []
  if (validRatio > VALID_BUDGET) failures.push(`FAIL validateJSON scanner cost: a valid document costs ${validRatio.toFixed(2)}x isValidJSON, over the ${VALID_BUDGET}x budget; the verdict is not coming from the scanner`)
  if (invalidRatio > INVALID_BUDGET) failures.push(`FAIL validateJSON scanner cost: an invalid document costs ${invalidRatio.toFixed(2)}x JSON.parse, over the ${INVALID_BUDGET}x budget; the scan is being paid on top of the native attempt (${require('node:os').cpus()[0].model.trim()}, Node ${process.version})`)
  return { failures, validRatio, invalidRatio }
}, (r) => `validateJSON scanner cost (${require('node:os').cpus()[0].model.trim()}, Node ${process.version}): valid ${r.validRatio.toFixed(2)}x isValidJSON (budget ${VALID_BUDGET}), invalid ${r.invalidRatio.toFixed(2)}x JSON.parse (budget ${INVALID_BUDGET})`)
