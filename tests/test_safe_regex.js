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
  // anchoring: only a leading ^ may skip the per-position restart
  ['$', 'ab', true],
  ['a$', 'ba', true],
  ['^$', '', true],
  ['^$', 'a', false],
  ['(^a|b)', 'cb', true],
  ['(^a|b)', 'ca', false],
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

// --- Escapes the engine does not implement must be refused, not read as literals ---
// `\B`, `\c` and `\k` have a meaning in ECMA-262 that the engine does not
// implement; reading them as the letters B, c and k accepted "Ba" for ^\B(a|a)$.
// `\p{...}` and `\P{...}` were read as the letters p and P; callers that ask
// patternIsSafe directly (defaults, ata verify) matched "p{L}" for ^\p{L}+$.
// Malformed `\x` and `\u` read as NaN and matched U+0000. Each one throws so
// patternIsSafe answers false and the pattern takes the platform RegExp.
const { patternIsSafe } = require('../lib/safe-regex')
const unsupportedEscapes = ['^\\p{L}+$', '^\\P{Lu}$', '^[\\p{L}]$', '^\\B(a|a)$', '^(a|a)\\cJ$', '^(a|a)\\k<x>$', '^(a|a)\\xZZ$', '^(a|a)\\u12$', '^(a|a)\\x4$', '^(a|a)\\01$', '[\\c]', '[\\xZZ]']
for (const p of unsupportedEscapes) {
  check(patternIsSafe(p) === false, `patternIsSafe(${JSON.stringify(p)}) === false`)
}
// Identity escapes that ECMA-262 reads as the letter stay supported.
for (const [p, s, expected] of [['^\\e$', 'e', true], ['^\\x41$', 'A', true], ['^\\u0041$', 'A', true], ['^[\\b]$', '\b', true]]) {
  check(compileSafe(p).test(s) === expected, `/${p}/.test(${JSON.stringify(s)}) === ${expected}`)
}

// --- Compile budget: repetition counts multiply through nesting ---
// The program expands {n} by copying the child n times, so (((a|a)*){1000}){1000}
// was a million copies (1.6 GB) and one level more aborted the process. The
// instruction count is bounded; past the budget compileSafe throws and the
// pattern is declined.
const hugeRepeats = ['^a{100000000}$', '((a|a)*){200000}', '(((a|a)*){1000}){1000}', '((((a|a)*){1000}){1000}){1000}', '^(a{10000}){10000}$', '(a|b){70000}', '^[a-z]{300,100000}$']
for (const p of hugeRepeats) {
  const t0 = Date.now()
  const safe = patternIsSafe(p)
  const ms = Date.now() - t0
  check(safe === false && ms < 200, `patternIsSafe(${JSON.stringify(p)}) === false within the budget: ${ms}ms`)
}
// Ordinary counted repeats are well inside the budget.
for (const p of ['^a{1000}$', '^(ab){500}c{2,300}$', '^\\d{3}-\\d{4}$', '^(?:[a-f0-9]{8}-){4}[a-f0-9]{12}$']) {
  check(patternIsSafe(p) === true, `patternIsSafe(${JSON.stringify(p)}) === true`)
}
check(compileSafe('^a{1000}$').test('a'.repeat(1000)) === true && compileSafe('^a{1000}$').test('a'.repeat(999)) === false, 'a{1000} still counts exactly')

// --- Unicode property escapes on the interpreted engine ---
// The linear engine refuses them, so the platform RegExp runs them under the
// u flag. One without a nested loop runs in linear time there; one with a
// nested loop can backtrack, which SECURITY.md names. The answers are the
// u-flag RegExp's in both cases.
{
  const { Validator } = require('..')
  for (const [p, ok, bad] of [['^\\p{L}+$', 'é'.repeat(100000), 'é'.repeat(100000) + '1'], ['^\\p{Lu}\\p{Ll}*$', 'Ç' + 'ş'.repeat(100000), 'ç' + 'ş'.repeat(100000)], ['^[^\\p{L}]+$', '1'.repeat(100000), '1'.repeat(100000) + 'a']]) {
    const v = new Validator({ type: 'string', pattern: p }, { engine: 'interpreter' })
    v.validate('x')
    const t0 = Date.now()
    const answers = [v.validate(ok).valid, v.validate(bad).valid]
    const ms = Date.now() - t0
    check(answers[0] === true && answers[1] === false, `interpreter /${p}/ answers as the u-flag RegExp`)
    check(ms < 200, `interpreter /${p}/ on 100000 characters: ${ms}ms (< 200ms)`)
  }
  const nested = new Validator({ type: 'string', pattern: '^(\\p{L}+)+$' }, { engine: 'interpreter' })
  check(nested.validate('abcé').valid === true && nested.validate('ab1').valid === false, 'a nested loop around \\p{L} still answers as the RegExp')
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
