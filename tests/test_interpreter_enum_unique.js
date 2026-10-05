'use strict'

// The interpreted engine answers enum membership from a Set of the primitive
// values, and every engine answers uniqueItems through lib/unique-items.js:
// a Set or Map keyed by value, or by a structural hash confirmed with deep
// equality, where they used to compare every pair or build a canonical string
// per item. Held here to the pairwise deep-equality scan, the old definition,
// on random values: short and long arrays, objects with the same members in
// another key order, 1 and 1.0, 0 and -0, nested arrays, and values that hash
// alike without being equal (1 and 2^32 + 1), so colliding buckets are walked.
// The uniqueItems error must name the pair the scan finds (the first item
// that has a later equal, and its first later equal), on the interpreter and
// on generated code, through every read.

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
  if (depth > 2 || r < 0.55) return pick([0, -0, 1, 1.0, 2, 4294967297, 4294967298, 'a', 'b', '1', true, false, null, 2.5])
  if (r < 0.75) return Array.from({ length: Math.floor(rnd() * 3) }, () => value(depth + 1))
  const ks = ['x', 'y', 'z'].filter(() => rnd() < 0.6)
  if (rnd() < 0.5) ks.reverse()
  const o = {}
  for (const k of ks) o[k] = value(depth + 1)
  return o
}
const scanPair = (a) => { for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (deq(a[i], a[j])) return [i, j]; return null }

const engines = {
  interpreter: new Validator({ type: 'array', uniqueItems: true }, { engine: 'interpreter', richErrors: false }),
  generated: new Validator({ type: 'array', uniqueItems: true }, { richErrors: false }),
  nested: new Validator({ type: 'object', properties: { list: { type: 'array', uniqueItems: true } }, anyOf: [{ required: ['list'] }, { required: ['other'] }] }, { richErrors: false }),
}
let arrays = 0, dupes = 0
for (let k = 0; k < 6000; k++) {
  // Mostly arrays of objects, which take the hash path past 12 items.
  const objs = rnd() < 0.5
  const n = Math.floor(rnd() * 40)
  const a = Array.from({ length: n }, () => objs ? { v: value(1), w: pick([1, 4294967297]) } : value(0))
  const want = scanPair(a)
  for (const [name, v] of Object.entries(engines)) {
    const doc = name === 'nested' ? { list: a } : a
    const r = v.validate(doc)
    assert.strictEqual(r.valid, want === null, `${name} verdict for ${JSON.stringify(a)}`)
    assert.strictEqual(v.isValidObject(doc), want === null, `${name} isValidObject for ${JSON.stringify(a)}`)
    if (want !== null) assert.deepStrictEqual([r.errors[0].params.i, r.errors[0].params.j], want, `${name} pair for ${JSON.stringify(a)}`)
    if (k % 20 === 0) {
      const t = JSON.stringify(doc)
      assert.strictEqual(v.isValidJSON(t), want === null, `${name} isValidJSON for ${t}`)
      const j = v.validateJSON(t)
      if (want !== null) assert.deepStrictEqual([j.errors[0].params.i, j.errors[0].params.j], want, `${name} validateJSON pair for ${t}`)
    }
  }
  if (want !== null) dupes++
  arrays++
}
assert.strictEqual(engines.generated.engine(), 'codegen', 'the generated engine answers')

// A duplicate whose keys are written in another order, at every depth, past
// the 12 items compared pairwise: the case that relies on the hash ignoring
// key order. Built directly, since random arrays rarely hold one.
let reordered = 0
for (let n = 13; n <= 40; n++) {
  for (const p of [0, Math.floor(n / 2), n - 1]) {
    const a = Array.from({ length: n }, (_, i) => ({ id: i, tag: 't', meta: { a: i % 3, b: [i, { c: 1, d: 2 }] } }))
    const src = a[p]
    a.push({ meta: { b: [src.meta.b[0], { d: 2, c: 1 }], a: src.meta.a }, tag: 't', id: src.id })
    for (const [name, v] of Object.entries(engines)) {
      const doc = name === 'nested' ? { list: a } : a
      const r = v.validate(doc)
      assert.strictEqual(r.valid, false, `${name}: reordered duplicate of item ${p} of ${n}`)
      assert.deepStrictEqual([r.errors[0].params.i, r.errors[0].params.j], [p, n], `${name}: pair for the reordered duplicate of item ${p} of ${n}`)
      assert.strictEqual(v.isValidObject(doc), false, `${name}: verdict for the reordered duplicate of item ${p} of ${n}`)
    }
    reordered++
  }
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
assert.ok(dupes > 800 && dupes < arrays - 800, `expected both outcomes often, got ${dupes} duplicates in ${arrays}`)
console.log(`ok: enum and uniqueItems agree with the pairwise deep-equality scan on the interpreter and generated code (${arrays} arrays, ${dupes} with a duplicate, ${reordered} reordered duplicates; ${enums} enum checks)`)
