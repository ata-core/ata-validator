'use strict'

// Integration: ata's validation paths must run user `pattern` regexes through the
// linear-time engine (lib/safe-regex.js), so adversarial input cannot trigger
// catastrophic backtracking. Patterns the engine cannot represent fall back to
// JS RegExp, so behavior for those is unchanged.

const { Validator } = require('..')

let pass = 0, fail = 0
function check (cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }
function load (code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports }

// A pattern that is catastrophic under a backtracking engine but trivial under a
// linear one, paired with an input that never matches (forces the worst case).
const EVIL = '^(a+)+$'
const EVIL_INPUT = 'a'.repeat(40) + '!'
const BUDGET_MS = 50

function timed (fn) { const t0 = Date.now(); const out = fn(); return { out, ms: Date.now() - t0 } }

console.log('\nReDoS-safe regex integration\n')

// --- Runtime: boolean path (isValidObject) ---
{
  const v = new Validator({ type: 'string', pattern: EVIL })
  const { out, ms } = timed(() => v.isValidObject(EVIL_INPUT))
  check(out === false && ms < BUDGET_MS, `isValidObject adversarial input: ${ms}ms (<${BUDGET_MS}), valid=${out}`)
}

// --- Runtime: full validate() (boolean first pass + error collection) ---
{
  const v = new Validator({ type: 'string', pattern: EVIL })
  const { out, ms } = timed(() => v.validate(EVIL_INPUT))
  check(out && out.valid === false && ms < BUDGET_MS, `validate() adversarial string: ${ms}ms (<${BUDGET_MS}), valid=${out && out.valid}`)
}

// --- Runtime: validate() with pattern on an object property (combined path) ---
{
  const v = new Validator({ type: 'object', properties: { s: { type: 'string', pattern: EVIL } }, required: ['s'] })
  const { out, ms } = timed(() => v.validate({ s: EVIL_INPUT }))
  check(out && out.valid === false && ms < BUDGET_MS, `validate() adversarial object prop: ${ms}ms (<${BUDGET_MS}), valid=${out && out.valid}`)
}

// --- Standalone module: same adversarial schema must be safe once loaded ---
{
  const code = new Validator({ type: 'object', properties: { s: { type: 'string', pattern: EVIL } }, required: ['s'] }).toStandaloneModule({ format: 'cjs' })
  const mod = load(code)
  const { out, ms } = timed(() => mod.validate({ s: EVIL_INPUT }))
  check(out && out.valid === false && ms < BUDGET_MS, `standalone validate adversarial: ${ms}ms (<${BUDGET_MS}), valid=${out && out.valid}`)
}

// --- toStandalone (boolFn + errFn) must be safe on adversarial input ---
{
  const code = new Validator({ type: 'object', properties: { s: { type: 'string', pattern: EVIL } }, required: ['s'] }).toStandalone()
  const mod = load(code)
  const input = { s: EVIL_INPUT }
  const r1 = timed(() => mod.boolFn(input))
  check(r1.out === false && r1.ms < BUDGET_MS, `toStandalone boolFn adversarial: ${r1.ms}ms (<${BUDGET_MS}), valid=${r1.out}`)
  const r2 = timed(() => mod.errFn(input, true))
  check(r2.out && r2.out.valid === false && r2.ms < BUDGET_MS, `toStandalone errFn adversarial: ${r2.ms}ms (<${BUDGET_MS}), valid=${r2.out && r2.out.valid}`)
}

// --- bundleStandalone must be safe on adversarial input ---
{
  const src = Validator.bundleStandalone([{ type: 'object', properties: { s: { type: 'string', pattern: EVIL } }, required: ['s'] }])
  const validators = load(src)
  const { out, ms } = timed(() => validators[0]({ s: EVIL_INPUT }))
  check(out && out.valid === false && ms < BUDGET_MS, `bundleStandalone adversarial: ${ms}ms (<${BUDGET_MS}), valid=${out && out.valid}`)
}

// --- bundleCompact must be safe on adversarial input ---
{
  const src = Validator.bundleCompact([{ type: 'object', properties: { s: { type: 'string', pattern: EVIL } }, required: ['s'] }])
  const validators = load(src)
  const { out, ms } = timed(() => validators[0]({ s: EVIL_INPUT }))
  check(out && out.valid === false && ms < BUDGET_MS, `bundleCompact adversarial: ${ms}ms (<${BUDGET_MS}), valid=${out && out.valid}`)
}

// --- Correctness: a supported pattern still accepts/rejects exactly like RegExp ---
{
  const v = new Validator({ type: 'string', pattern: '^(cat|dog|bird)$' })
  check(v.isValidObject('dog') === true, 'supported pattern: "dog" matches ^(cat|dog|bird)$')
  check(v.isValidObject('fish') === false, 'supported pattern: "fish" does not match')
  check(v.validate('fish').valid === false, 'supported pattern: validate() rejects "fish"')
}

// --- Fallback: an unsupported pattern (backreference) must still work via RegExp ---
{
  const v = new Validator({ type: 'string', pattern: '(a)\\1' })
  check(v.isValidObject('aa') === true, 'fallback (backref): "aa" matches (a)\\1')
  check(v.isValidObject('ab') === false, 'fallback (backref): "ab" does not match')
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
