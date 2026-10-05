'use strict'

// The bounded distance computes only the band within the bound of the
// diagonal on longer strings (banded in lib/levenshtein.js). Held here to a
// full table on random strings over a small alphabet, where near misses are
// common, at every bound a typo hint uses and a few more. A result past the
// bound may come back as Infinity or as any number past it; callers compare
// it with the bound.

const assert = require('node:assert')
const { levenshtein } = require('../lib/levenshtein')

function full (a, b) {
  const d = []
  for (let i = 0; i <= a.length; i++) d[i] = [i]
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return d[a.length][b.length]
}

let seed = 7
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const word = (n) => { let s = ''; for (let i = 0; i < n; i++) s += 'abcab'[Math.floor(rnd() * 5)]; return s }
let compared = 0, withinBound = 0
for (let k = 0; k < 120000; k++) {
  const a = word(Math.floor(rnd() * 16))
  const cut = Math.floor(rnd() * (a.length + 1))
  const b = rnd() < 0.5 ? word(Math.floor(rnd() * 16)) : a.slice(0, cut) + word(Math.floor(rnd() * 3)) + a.slice(cut + Math.floor(rnd() * 3))
  const want = full(a, b)
  for (const max of [0, 1, 2, 3, 5, undefined]) {
    const got = levenshtein(a, b, max)
    if (max === undefined) { assert.strictEqual(got, want, `${a} ${b} unbounded`); compared++; continue }
    if (want <= max) { assert.strictEqual(got, want, `${a} ${b} bound ${max}`); withinBound++ } else assert.ok(got > max, `${a} ${b} bound ${max}: ${got}, distance ${want}`)
    compared++
  }
}
assert.ok(withinBound > 50000, `expected many pairs within the bound, got ${withinBound}`)
console.log(`ok: bounded distance matches the full table on ${compared} comparisons (${withinBound} within the bound)`)
