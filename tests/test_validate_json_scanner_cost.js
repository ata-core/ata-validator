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

// The regression this file guards, the scan paid on top of the native
// attempt, is checked by counting rather than timing: once the scanner has
// said a document is invalid, the native validator must not run on it. A
// timing ratio against JSON.parse could not hold this on every machine, since
// it compares C++ with JavaScript: on CI the same code read 2.25x on an AMD
// EPYC 7763 and 2.88x on an Intel Xeon Platinum 8573C. The count is the same
// everywhere. It is checked to see the native call at all first, so it cannot
// pass by counting nothing.
{
  const { getNative } = require('../lib/validator-core')._internals
  const native = getNative()
  if (!native) {
    console.log('skip: native scanner witness (no native addon here)')
  } else {
    const real = native.rawFastValidate
    let calls = 0
    native.rawFastValidate = function () { calls++; return real.apply(this, arguments) }
    try {
      const w = new Validator(schema)
      assert.ok(badTexts[0].length >= 8192, 'the document is past the native threshold')
      w.validateJSON(badTexts[2])
      assert.strictEqual(calls, 1, 'before the scanner is built, a large document goes to the native validator')
      assert.ok(w._ensureScanner(true), 'the scanner builds for this schema')
      const before = calls
      for (let k = 0; k < 5; k++) assert.strictEqual(w.validateJSON(badTexts[3 + k]).valid, false)
      assert.strictEqual(calls, before, 'once the scanner says invalid, the native validator does not run')
      assert.strictEqual(w.validateJSON(badTexts[9]).errors.length, 1, 'and the errors are still produced')
    } finally {
      native.rawFastValidate = real
    }
    console.log('ok: a document the scanner rejects skips the native attempt (native calls counted)')
  }
}

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
// The invalid ratio compares JavaScript with the C++ JSON.parse, so it moves
// with the CPU: healthy, 2.0x to 2.4x on most runners and 2.88x on a Xeon
// Platinum 8573C, while the scan paid twice read 2.8x to 3.5x. No one budget
// separates those everywhere, so the count above is the guard and this is a
// backstop for a gross regression, such as the document parsed twice.
const INVALID_BUDGET = 3.6
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
