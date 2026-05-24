'use strict'

// A linear-time regex engine (Thompson NFA / Pike VM) for JSON Schema `pattern`.
// Goal: match the same strings as JS RegExp for the supported (RE2) subset, but
// with no catastrophic backtracking, so an adversarial input cannot hang a
// validator. Backreferences and lookaround are out of scope (linear engines, and
// ata's native RE2 path, do not support them).

const { compileSafe } = require('../lib/safe-regex')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }

console.log('\nlinear-time safe regex engine\n')

// --- Correctness: must agree with JS RegExp on the supported subset ---
const cases = [
  // pattern, input, expected
  ['abc', 'abc', true],
  ['abc', 'xabcy', true],          // unanchored, find anywhere
  ['^abc$', 'abc', true],
  ['^abc$', 'abcd', false],
  ['a.c', 'axc', true],
  ['a.c', 'ac', false],
  ['^[0-9]+$', '12345', true],
  ['^[0-9]+$', '12a45', false],
  ['^[a-z]+$', 'abc', true],
  ['^[^0-9]+$', 'abc', true],
  ['^[^0-9]+$', 'ab3', false],
  ['^\\d{3}-\\d{4}$', '123-4567', true],
  ['^\\d{3}-\\d{4}$', '12-4567', false],
  ['^a{2,4}$', 'aaa', true],
  ['^a{2,4}$', 'a', false],
  ['^a{2,4}$', 'aaaaa', false],
  ['^(cat|dog|bird)$', 'dog', true],
  ['^(cat|dog|bird)$', 'fish', false],
  ['^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$', 'mert@example.com', true],
  ['^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$', 'nope', false],
  ['^https?://', 'https://x', true],
  ['^https?://', 'ftp://x', false],
  ['^\\w+$', 'foo_bar1', true],
  ['^\\w+$', 'foo bar', false],
  ['^a*$', '', true],
  ['^a*$', 'aaa', true],
  ['colou?r', 'color', true],
  ['colou?r', 'colour', true],
]

for (const [pattern, input, expected] of cases) {
  let got
  try { got = compileSafe(pattern).test(input) } catch (e) { got = 'THREW: ' + e.message }
  check(got === expected, `/${pattern}/.test(${JSON.stringify(input)}) === ${expected} (got ${got})`)
}

// --- Safety: catastrophic patterns must stay fast ---
const evilCases = [
  ['^(a+)+$', 'a'.repeat(40) + '!'],
  ['^(a|a)*$', 'a'.repeat(40) + '!'],
  ['^(.*a){20}$', 'a'.repeat(40) + '!'],
]
for (const [pattern, input] of evilCases) {
  const t0 = Date.now()
  let ok = false
  try { compileSafe(pattern).test(input); ok = true } catch { ok = false }
  const ms = Date.now() - t0
  check(ok && ms < 50, `catastrophic /${pattern}/ stays linear: ${ms}ms (< 50ms)`)
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
