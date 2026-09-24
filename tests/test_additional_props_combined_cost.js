'use strict'

// `additionalProperties: false` must not cost the combined generator an
// allocation on every accepted document.
//
// The verdict generator counts the keys with a for-in and compares the count, so
// a clean object costs one pass and no allocation. The combined generator has to
// name the offending property in its error, so it called `Object.keys` and walked
// the array, paying for the array and the walk even when nothing was extra. On a
// small request body that made the combined function 2.31x the verdict function
// on a valid document, where every other keyword measured 1.04x to 1.25x, and
// that one keyword is in most strict schemas.
//
// It matters beyond this keyword: the combined function is the one that can give
// a verdict and every error in a single pass, and it can only replace the
// verdict-then-revalidate pair if it is not slower on accepted documents.
//
// A for-in decides whether anything is extra, and the keys are only materialised
// when something is. Measured on three declared properties: the check itself went
// 12.93 ns to 9.71, against the verdict generator's 8.91 floor, and the whole
// function went 2.80x the verdict function to 1.59x. The budget is that ratio, so
// machine speed drops out. It sits at 1.9 rather than 1.6 because 1.25x of what
// remains is the combined function's own shape on this schema, measured with the
// keyword removed, and a gate against the 2.8x regime does not need to be tighter
// than that.

const assert = require('node:assert')
const { compileToJSCombined, compileToJSCodegen } = require('../lib/js-compiler')

const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) })
const schema = {
  type: 'object',
  required: ['a', 'b', 'c'],
  additionalProperties: false,
  properties: { a: { type: 'string' }, b: { type: 'integer' }, c: { type: 'boolean' } },
}

const combined = compileToJSCombined(schema, VALID, new Map(), undefined)
const verdict = compileToJSCodegen(schema, new Map(), {})
assert.ok(combined, 'the combined generator should handle this schema')
assert.ok(verdict, 'the verdict generator should handle this schema')

// Answers first, including the case the count shortcut could get wrong: an extra
// key present while a declared one is missing, where the key count matches the
// declared count and nothing may be skipped.
const cases = [
  [{ a: 'x', b: 1, c: true }, true, 'clean'],
  [{ a: 'x', b: 1, c: true, extra: 1 }, false, 'one extra key'],
  [{ a: 'x', b: 1, c: true, e1: 1, e2: 2 }, false, 'two extra keys'],
  [{ a: 'x', b: 1, extra: 1 }, false, 'an extra key while c is missing'],
  [{ extra: 1 }, false, 'nothing but an extra key'],
  [{ a: 'x', b: 1 }, false, 'a declared property missing'],
  [{}, false, 'empty'],
]
for (const [doc, wantValid, why] of cases) {
  const r = combined(doc)
  assert.strictEqual(r.valid === true, wantValid, `combined on ${why}: ${JSON.stringify(r.errors || [])}`)
  if (!wantValid) {
    const extras = Object.keys(doc).filter((k) => !['a', 'b', 'c'].includes(k))
    const named = (r.errors || []).filter((e) => e.keyword === 'additionalProperties').map((e) => e.params.additionalProperty).sort()
    assert.deepStrictEqual(named, extras.sort(), `combined on ${why} must name every extra key`)
  }
}
console.log(`ok: additionalProperties answers hold on ${cases.length} shapes, extras named`)

const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
function med (fn, iters) {
  for (let i = 0; i < 1000; i++) fn()
  const runs = []
  for (let r = 0; r < 9; r++) {
    const t = process.hrtime.bigint()
    for (let i = 0; i < iters; i++) fn()
    runs.push(Number(process.hrtime.bigint() - t) / iters)
  }
  return median(runs)
}

const docs = []
for (let i = 0; i < 100; i++) docs.push({ a: 'x' + i, b: i, c: true })
let i = 0
const A = [], B = []
for (let r = 0; r < 5; r++) {
  A.push(med(() => combined(docs[(i++) % 100]).valid, 5000))
  B.push(med(() => verdict(docs[(i++) % 100]), 5000))
}
const ratio = median(A) / median(B)

const BUDGET = 1.9
if (ratio > BUDGET) {
  console.error(`FAIL additionalProperties combined cost: the combined function is ${ratio.toFixed(2)}x the verdict function on a valid document, over the ${BUDGET}x budget; it is materialising the keys when nothing is extra`)
  process.exit(1)
}
console.log(`additionalProperties combined cost: ${ratio.toFixed(2)}x the verdict function on a valid document (budget ${BUDGET})`)
