'use strict'

// The interpreted engine answers enum membership from a Set of the primitive
// values and uniqueItems from a Set or Map keyed by value or canonical string,
// the algorithm the generators hoist as _uq and _uqp, where it used to compare
// every value and every pair with deepEqual. Held here to that pairwise
// deepEqual scan, the old definition, on random values: short and long arrays,
// objects with the same members in another key order, 1 and 1.0, 0 and -0,
// nested arrays. The uniqueItems error must name the same pair the scan finds
// (the first item that has a later equal, and its first later equal), and the
// whole engine is compared with the scan through validate().

const assert = require('node:assert')
const { Validator } = require('..')
const { deepEqual } = require('../lib/interpreter')._internals || {}
const deq = deepEqual || ((a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b)))
function canon (x) { if (x === null || typeof x !== 'object') return x; if (Array.isArray(x)) return x.map(canon); const o = {}; for (const k of Object.keys(x).sort()) o[k] = canon(x[k]); return o }

let seed = 11
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (a) => a[Math.floor(rnd() * a.length)]
function value (depth) {
  const r = rnd()
  if (depth > 2 || r < 0.55) return pick([0, -0, 1, 1.0, 2, 'a', 'b', '1', true, false, null, 2.5])
  if (r < 0.75) return Array.from({ length: Math.floor(rnd() * 3) }, () => value(depth + 1))
  const ks = ['x', 'y', 'z'].filter(() => rnd() < 0.6)
  if (rnd() < 0.5) ks.reverse()
  const o = {}
  for (const k of ks) o[k] = value(depth + 1)
  return o
}
const scanPair = (a) => { for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (deq(a[i], a[j])) return [i, j]; return null }

const uniq = new Validator({ type: 'array', uniqueItems: true }, { engine: 'interpreter', richErrors: false })
let arrays = 0, dupes = 0
for (let k = 0; k < 6000; k++) {
  const n = Math.floor(rnd() * 30)
  const a = Array.from({ length: n }, () => value(0))
  const want = scanPair(a)
  const r = uniq.validate(a)
  assert.strictEqual(r.valid, want === null, `verdict for ${JSON.stringify(a)}`)
  assert.strictEqual(uniq.isValidObject(a), want === null, `isValidObject for ${JSON.stringify(a)}`)
  if (want !== null) {
    dupes++
    assert.deepStrictEqual([r.errors[0].params.i, r.errors[0].params.j], want, `pair for ${JSON.stringify(a)}`)
  }
  arrays++
}

let enums = 0
for (let k = 0; k < 400; k++) {
  const vals = Array.from({ length: 1 + Math.floor(rnd() * 25) }, () => value(0))
  const v = new Validator({ enum: vals }, { engine: 'interpreter', richErrors: false })
  for (let t = 0; t < 20; t++) {
    const d = rnd() < 0.5 ? structuredClone(pick(vals)) : value(0)
    const want = vals.some((e) => deq(e, d))
    assert.strictEqual(v.validate(d).valid, want, `enum ${JSON.stringify(vals)} on ${JSON.stringify(d)}`)
    assert.strictEqual(v.isValidObject(d), want, `enum verdict ${JSON.stringify(vals)} on ${JSON.stringify(d)}`)
    enums++
  }
}
assert.ok(dupes > 1000 && dupes < arrays - 1000, `expected both outcomes often, got ${dupes} duplicates in ${arrays}`)
console.log(`ok: interpreted enum and uniqueItems agree with the pairwise deepEqual scan (${arrays} arrays, ${dupes} with a duplicate; ${enums} enum checks)`)
