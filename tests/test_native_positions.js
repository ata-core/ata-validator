'use strict'

// Error frames on validateJSON() locate the failing value in the text. With
// the native addon, a large ASCII document is located through simdjson
// (lib/native-positions.js); this holds every entry it gives to the script
// walker's, on minified and indented documents, escaped and odd keys, and
// pointers at every depth. Without the addon it reports what it compared and
// that the native path was not there to compare.

const assert = require('node:assert')
const { buildTargetedPositionMap } = require('../lib/data-positions')
const { createCache } = require('../lib/data-position-cache')


let native = null
try { native = require('../lib/native-load')() } catch {}
const hasNative = !!(native && typeof native.locatePointers === 'function')
let calls = 0
if (hasNative) { const orig = native.locatePointers; native.locatePointers = (...a) => { calls++; return orig(...a) } }

const base = { 'a"b': { 'x\\y': [1, { 'q"r': 'v', 'sp ace': [true, null, -2.5e3] }] }, 'k/~': { '': 0 } }
const docs = [
  JSON.stringify({ ...base, list: Array.from({ length: 4000 }, (_, i) => ({ id: i, name: 'n' + i, tags: ['a', 'b'], deep: { v: i % 7 } })) }),
  JSON.stringify({ ...base, list: Array.from({ length: 2500 }, (_, i) => ({ id: i, s: 'x'.repeat(i % 40) })) }, null, 2),
  JSON.stringify([{ pad: 'z'.repeat(50000) }, base, { tail: [1, [2, [3, { last: 'here' }]]] }], null, '\t'),
]
let compared = 0
for (const text of docs) {
  const obj = JSON.parse(text)
  const ptrs = []
  const walk = (n, p, d) => {
    ptrs.push(p)
    if (d > 7 || n === null || typeof n !== 'object') return
    const ks = Array.isArray(n) ? n.map((_, i) => i) : Object.keys(n)
    for (const k of ks.length > 12 ? [ks[0], ks[1], ks[Math.floor(ks.length / 2)], ks[ks.length - 1]] : ks) {
      walk(n[k], p + '/' + String(k).replace(/~/g, '~0').replace(/\//g, '~1'), d + 1)
    }
  }
  walk(obj, '', 0)
  for (let s = 0; s < ptrs.length; s += 5) {
    const wanted = new Set(ptrs.slice(s, s + 5))
    const a = buildTargetedPositionMap(text, wanted)
    const b = createCache(require('../lib/native-positions').nativeTargeted).targeted(text, wanted)
    for (const w of wanted) { assert.deepStrictEqual(b[w], a[w], `${w} in a ${text.length} character document`); compared++ }
  }
}
if (hasNative) assert.ok(calls > 0, 'expected the native locator to answer for large ASCII documents')
console.log(`ok: ${compared} error positions are the same from the ${hasNative ? 'native locator (' + calls + ' calls)' : 'script walker only, no addon here'} and the script walker`)
