'use strict'

// A rejection must not validate the document twice.
//
// The hybrid assembly runs the verdict function and, when it says no, hands the
// document to the error resolver, which runs the combined function over the whole
// document again. The combined function decides and collects in one pass, so the
// verdict pass in front of it is pure duplication: on a 1000-user array
// `validate(bad).errors` measured 134.1 microseconds where the combined function
// alone answers the same thing in 45.3.
//
// The verdict pass was in front for a reason. Compiling the combined function
// eagerly triples what a first call costs (verdict-only 8.65 ms against 26.25),
// and until `additionalProperties: false` stopped materialising its key array the
// combined function was also 1.24x the verdict function on accepted documents, so
// making it the only path would have taxed every valid request. It is now 1.02x on
// that array and 0.99x on a small request body, which is what makes this safe.
//
// So the shape is: hybrid until the first rejection, and from then on the combined
// function, one pass. The first rejection still pays twice, the compile stays lazy,
// and accepted documents are unaffected.
//
// One more layer still does this at the API level: index.js ~1943 answers the
// verdict from the boolean engine and hands back a LazyRejection whose
// `_buildErrors` runs the whole inner pipeline again on first read. That is the
// same deliberate trade one level up, and the same argument now applies to it,
// since the combined function costs what the verdict function costs on accepted
// documents. Until that is taken too, a rejection whose errors are read is two
// passes rather than three.
//
// The budget is the ratio to the verdict-only API on the same document, so machine
// speed drops out. Measured 3.15x before, 2.13x after.

const assert = require('node:assert')
const { Validator } = require('..')

const item = {
  type: 'object',
  required: ['id', 'name', 'email'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    active: { type: 'boolean' },
    role: { enum: ['admin', 'user', 'moderator'] },
  },
}
const schema = { type: 'object', required: ['users'], properties: { users: { type: 'array', items: item } } }

const user = (i, bad) => ({
  id: bad ? 0 : i + 1,
  name: bad ? '' : 'user' + i,
  email: bad ? 'not-an-email' : 'user' + i + '@example.com',
  age: bad ? 999 : 30,
  active: true,
  role: bad ? 'nope' : 'user',
})
const mk = (bad, tag) => ({ users: Array.from({ length: 1000 }, (_, i) => user(i, bad && i === 999)), _t: tag })

const v = new Validator(schema)
const good = [], bad = []
for (let i = 0; i < 40; i++) { good.push(mk(false, i)); bad.push(mk(true, i)) }

// Answers, and the full enriched shape, before any timing. The point of the
// change is that the second pass goes away, not the diagnostics.
{
  assert.strictEqual(v.validate(good[0]).valid, true, 'a clean document is valid')
  const r = v.validate(bad[0])
  assert.strictEqual(r.valid, false)
  const byPath = Object.fromEntries(r.errors.map((e) => [e.instancePath, e]))
  assert.deepStrictEqual(
    Object.keys(byPath).sort(),
    ['/users/999/age', '/users/999/email', '/users/999/id', '/users/999/name', '/users/999/role'],
    `expected the five errors, got ${JSON.stringify(Object.keys(byPath))}`,
  )
  for (const [path, e] of Object.entries(byPath)) {
    assert.ok(e.code, `${path} carries a code`)
    assert.ok(e.docUrl, `${path} carries a docUrl`)
    assert.ok(e.keyword, `${path} carries a keyword`)
    assert.ok('received' in e, `${path} carries the received value`)
  }
  // Reading twice is stable, and a second document is not confused by the first.
  assert.strictEqual(JSON.stringify(v.validate(bad[1]).errors.length), '5')
  assert.strictEqual(v.validate(good[1]).valid, true, 'a clean document after a rejection is still valid')
  assert.strictEqual(v.isValidObject(good[2]), true)
  assert.strictEqual(v.isValidObject(bad[2]), false)
  console.log('ok: five enriched errors, and the verdict API still agrees')
}

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1]
function time (fn, iters) {
  const t = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) fn()
  return Number(process.hrtime.bigint() - t) / iters
}

// The three timings are taken in short alternating blocks, and each round gives
// its own ratios. A shared runner changes speed from one moment to the next; when
// the timings were taken one after another, a slow stretch landed on one of them
// and moved the ratio by 20%. Within a round the three see the same machine, so
// the slowdown divides out, and the median over rounds drops the rounds a pause
// landed in. The accepted document is compared with the verdict on accepted
// documents, the same work.
const N = 10
const ROUNDS = 25
let i = 0
// Measured this way the single pass reads 2.1x to 2.3x on Node 24 and 25 and
// 2.3x to 2.55x on Node 20. The same document validated twice, a verdict pass in
// front of the combined function, reads 3.2x to 3.3x on Node 25 and 3.45x to
// 3.6x on Node 20. The budget sits between the two on every version.
const ERR_BUDGET = 2.85
const VALID_BUDGET = 1.25
const errorsRead = () => v.validate(bad[(i++) % 40]).errors.length
const verdictBad = () => v.isValidObject(bad[(i++) % 40])
const validRead = () => v.validate(good[(i++) % 40]).valid
const verdictGood = () => v.isValidObject(good[(i++) % 40])
for (let w = 0; w < 30; w++) { errorsRead(); verdictBad(); validRead(); verdictGood() }
require('./_ratio_gate').ratioGate(() => {
  const errR = [], validR = []
  for (let r = 0; r < ROUNDS; r++) {
    const e = time(errorsRead, N)
    const vb = time(verdictBad, N)
    const a = time(validRead, N)
    const vg = time(verdictGood, N)
    errR.push(e / vb)
    validR.push(a / vg)
  }
  const errRatio = median(errR)
  const validRatio = median(validR)
  const failures = []
  if (errRatio > ERR_BUDGET) failures.push(`FAIL single pass errors: reading errors costs ${errRatio.toFixed(2)}x the verdict, over the ${ERR_BUDGET}x budget; the document is being validated more than once`)
  if (validRatio > VALID_BUDGET) failures.push(`FAIL single pass errors: an accepted document costs ${validRatio.toFixed(2)}x the verdict API, over the ${VALID_BUDGET}x budget; the accepted path was taxed to pay for the error path`)
  return { failures, errRatio, validRatio }
}, (r) => `single pass errors: errors ${r.errRatio.toFixed(2)}x the verdict (budget ${ERR_BUDGET}), accepted ${r.validRatio.toFixed(2)}x (budget ${VALID_BUDGET})`)
