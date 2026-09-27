'use strict'

// A pattern that matches one fixed-length sequence of single characters is
// compiled into one character test per position instead of going through a
// regex. That test has to answer exactly what the regex answers. This builds
// seeded random patterns out of the pieces the unrolling accepts, and strings
// that match them, miss by one character, run one too long or too short, or
// carry characters outside ASCII, and compares the generated verdict with the
// pattern compiled by the engine itself, through every entry point that checks
// a pattern. It reports how many patterns were unrolled, so a change that
// makes the unrolling decline everything cannot pass by comparing nothing.

const assert = require('assert')
const { compileToJSCodegen } = require('../lib/js-compiler')
const { Validator } = require('..')

let x = 0x6d2b79f5
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k }
const pick = (a) => a[rnd(a.length)]

const CLASSES = ['[A-Z]', '[a-z]', '[0-9]', '[A-Za-z]', '[a-f0-9]', '[A-Z0-9_-]', '[xyz]', '[-a]']
const LITERALS = ['-', '_', ':', '/', '@', ' ', 'X', '7', '\\.', '\\/', '\\(', '\\$']
function piece () {
  const k = rnd(4)
  if (k === 0) return { src: '\\d', gen: () => String(rnd(10)) }
  if (k === 1) {
    const lit = pick(LITERALS)
    const ch = lit.length === 2 ? lit[1] : lit
    return { src: lit, gen: () => ch }
  }
  const cls = pick(CLASSES)
  const re = new RegExp('^' + cls + '$')
  const pool = []
  for (let c = 32; c < 127; c++) if (re.test(String.fromCharCode(c))) pool.push(String.fromCharCode(c))
  return { src: cls, gen: () => pick(pool) }
}
function makePattern () {
  const parts = []
  const n = 1 + rnd(5)
  for (let i = 0; i < n; i++) {
    const p = piece()
    const count = rnd(3) === 0 ? 1 + rnd(5) : 1
    parts.push({ src: p.src + (count > 1 || rnd(4) === 0 ? `{${count}}` : ''), gen: p.gen, count })
  }
  return { pattern: '^' + parts.map((p) => p.src).join('') + '$', parts }
}
function matching (parts) { return parts.map((p) => Array.from({ length: p.count }, p.gen).join('')).join('') }
function variants (s) {
  const out = [s, s + 'a', s.slice(1), s.slice(0, -1), '', s + '\n', ' ' + s, s.toLowerCase(), s.toUpperCase()]
  if (s.length) {
    const i = rnd(s.length)
    for (const c of ['#', 'é', '\u{1F600}', '0', 'Z', '_', '-', 'İ']) out.push(s.slice(0, i) + c + s.slice(i + 1))
  }
  return out
}

let unrolled = 0, compared = 0, bad = 0
const report = (m) => { if (bad++ < 10) console.error(m) }
for (let t = 0; t < 1500; t++) {
  const { pattern, parts } = makePattern()
  const schema = { type: 'string', pattern }
  const fn = compileToJSCodegen(schema, null, null)
  if (!fn) continue
  if (/charCodeAt/.test(fn.toString()) && !/_re\d|test\(/.test(fn.toString())) unrolled++
  const re = new RegExp(pattern, 'u')
  const v = new Validator(schema)
  const ref = new Validator(schema, { engine: 'interpreter' })
  for (let j = 0; j < 4; j++) {
    for (const s of variants(matching(parts))) {
      const want = re.test(s)
      compared++
      if (fn(s) !== want) report(`verdict ${fn(s)} vs regex ${want}: ${pattern} on ${JSON.stringify(s)}`)
      if (v.validate(s).valid !== want) report(`validate disagrees with regex: ${pattern} on ${JSON.stringify(s)}`)
      if (v.validateJSON(JSON.stringify(s)).valid !== want) report(`validateJSON disagrees with regex: ${pattern} on ${JSON.stringify(s)}`)
      if (ref.validate(s).valid !== want) report(`interpreter disagrees with regex: ${pattern} on ${JSON.stringify(s)}`)
    }
  }
}

// The patterns this exists for, by name.
for (const [pattern, yes, no] of [
  ['^[A-Z]{3}-\\d{4}$', 'ABC-1234', 'abc-1234'],
  ['^\\d{3}-\\d{2}-\\d{4}$', '123-45-6789', '123456789'],
  ['^[A-Z]{2}\\.[0-9]$', 'AB.1', 'AB-1'],
  // A class of two ranges repeated a fixed number of times: accepted "xyz"
  // and "1a" from 0.12.1 to 1.32.2, because the range test was not grouped.
  ['^[A-Za-z]{2}$', 'ab', 'xyz'],
  ['^[A-Za-z]{2}$', 'Zq', '1a'],
]) {
  const fn = compileToJSCodegen({ type: 'string', pattern }, null, null)
  assert.ok(/charCodeAt/.test(fn.toString()), `${pattern} is unrolled`)
  assert.strictEqual(fn(yes), true, `${pattern} accepts ${yes}`)
  assert.strictEqual(fn(no), false, `${pattern} rejects ${no}`)
  compared += 2
}

assert.strictEqual(bad, 0, `${bad} disagreements with the regex`)
assert.ok(unrolled > 1000 && compared > 50000, `unrolled ${unrolled} patterns and compared ${compared} answers: too few`)
console.log(`ok: unrolled patterns agree with the regex on ${compared} answers over ${unrolled} unrolled patterns`)
