'use strict'

// Arrays with prefixItems, contains or uniqueItems take arrGeneral in
// lib/core/verdict-more.js. It reads the item code of items (the tail after
// prefixItems) and of contains once and runs one loop per code; a code that
// loop does not name takes the general loop. Here every leaf code, as the
// tail and as contains with minContains and maxContains, under
// unevaluatedItems too, is checked against the small engine on arrays of
// every JSON type plus holes, NaN, the infinities, -0 and the 2^31 edges.

const assert = require('node:assert')
const { createVerdict, _i } = require('../lib/core/verdict.js')
const { createSmall } = require('../lib/engine-small.js')
// Every schema-decided group (lib/groups.js), as the full 2.0 entries register them.
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)

// Item schemas, one or more for every code inline() gives (0 to 11).
const LEAVES = [
  { type: 'string' }, // 1
  { type: 'number' }, // 2
  { type: 'integer' }, // 3
  { type: 'boolean' }, // 4
  { type: 'null' }, // 5
  {}, true, { description: 'x' }, // 6
  { const: 1 }, { const: 'a' }, { const: null }, { const: true }, { const: 0 }, { type: 'number', const: 2 }, // 7
  { type: 'integer', minimum: 0, maximum: 65535 }, // 8
  { type: 'integer', minimum: -(2 ** 31), maximum: 2 ** 31 - 1 },
  { type: 'integer', minimum: 0, maximum: 2 ** 31 },
  { type: 'integer', minimum: 0.5, maximum: 10.5 },
  { type: 'integer', minimum: 3 }, { type: 'integer', maximum: -1 },
  { type: 'number', minimum: 0, maximum: 1 }, // 9
  { type: 'number', minimum: -0, maximum: 0 },
  { type: 'number', minimum: -(2 ** 31) - 0.5, maximum: 2 ** 31 + 0.5 },
  { type: 'number', minimum: 300 }, { type: 'number', maximum: 1.5 },
  { type: 'string', minLength: 1, maxLength: 3 }, { type: 'string', maxLength: 0 }, // 10
  { type: 'string', enum: ['a', 'tag', ''] }, // 11
  false, { not: {} }, { type: 'object' }, { type: 'array' }, { type: ['number', 'string'] }, // 0
  { minimum: 3 }, { multipleOf: 2 }, { exclusiveMinimum: 0 }, { type: 'number', exclusiveMaximum: 1 },
  { enum: [1, 'a', null, -0] }, { const: { a: 1 } }, { type: 'object', required: ['a'] },
  { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] }, { items: { type: 'number' } }
]

const codes = new Map()
const CTX = new _i.Ctx(null, null, false)
for (const s of LEAVES) codes.set(s, _i.inline(CTX, s)[0])

const POOL = ['a', '', 'tag', 'abcd', 'éé', 0, -0, 1, -1, 2, 3, 1.5, 0.5, 300, 382.5, NaN, Infinity, -Infinity,
  2 ** 31, 2 ** 31 - 1, -(2 ** 31), -(2 ** 31) - 1, 2 ** 31 + 0.5, 2 ** 53, 1e308, Number.MIN_VALUE, 65535, 65536,
  true, false, null, {}, { a: 1 }, [], [1], [1.5, 'a']]
const HOLE = {}

function arraysOf () {
  const out = [[]]
  for (const x of [...POOL, HOLE]) {
    for (let n = 1; n <= 4; n++) out.push(fill(Array.from({ length: n }, () => x)))
  }
  // One outlier at each position of a run of one type.
  for (const base of [1, 'a', 2.5, 0, -0, true, null, {}]) {
    for (const x of [...POOL, HOLE]) {
      for (let p = 0; p < 5; p++) {
        const a = Array.from({ length: 5 }, () => base)
        a[p] = x
        out.push(fill(a))
      }
    }
  }
  // Mixed, from a fixed seed.
  let seed = 12345
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n }
  for (let k = 0; k < 400; k++) {
    const a = Array.from({ length: 1 + rnd(7) }, () => { const i = rnd(POOL.length + 1); return i === POOL.length ? HOLE : POOL[i] })
    out.push(fill(a))
  }
  return out
}
// HOLE marks a position left empty.
function fill (a) {
  const r = new Array(a.length)
  for (let i = 0; i < a.length; i++) if (a[i] !== HOLE) r[i] = a[i]
  return r
}
const ARRAYS = arraysOf()

const SCHEMAS = []
const MIC = [undefined, 0, 1, 2, 3]
const MAC = [undefined, 0, 1, 2, 5]
for (const it of LEAVES) {
  // Tail after prefixItems.
  SCHEMAS.push({ type: 'array', prefixItems: [{ type: 'string' }], items: it })
  SCHEMAS.push({ prefixItems: [true, { type: 'number' }, {}], items: it })
  SCHEMAS.push({ type: 'array', prefixItems: [], items: it, uniqueItems: true })
  SCHEMAS.push({ type: 'array', items: it, uniqueItems: true })
  SCHEMAS.push({ prefixItems: [it], items: it, minItems: 1, maxItems: 4 })
  // contains, with and without counts.
  for (const mic of MIC) {
    for (const mac of MAC) {
      const s = { type: 'array', contains: it }
      if (mic !== undefined) s.minContains = mic
      if (mac !== undefined) s.maxContains = mac
      SCHEMAS.push(s)
    }
  }
  SCHEMAS.push({ prefixItems: [{ type: 'integer' }], items: it, contains: { type: 'number', minimum: 300 } })
  SCHEMAS.push({ items: { type: 'number' }, contains: it, maxContains: 2 })
  SCHEMAS.push({ contains: it, uniqueItems: true })
  // unevaluatedItems: what prefixItems and contains evaluated, with the tail
  // and contains also checked by arrGeneral.
  SCHEMAS.push({ prefixItems: [{ type: 'string' }], contains: it, unevaluatedItems: false })
  SCHEMAS.push({ prefixItems: [{}], contains: it, minContains: 0, unevaluatedItems: { type: 'string' } })
  SCHEMAS.push({ allOf: [{ prefixItems: [true], contains: it }], items: it, unevaluatedItems: false })
  SCHEMAS.push({ allOf: [{ contains: it, maxContains: 3 }], prefixItems: [{ type: 'number' }], unevaluatedItems: { type: 'integer' } })
  SCHEMAS.push({ anyOf: [{ prefixItems: [it, it] }, { contains: it }], unevaluatedItems: false })
}

// Every code reaches both the tail loop and the contains count.
const seen = new Set(LEAVES.map((s) => codes.get(s)))
for (let c = 0; c <= 11; c++) assert.ok(seen.has(c), 'leaf code ' + c + ' is covered')

let built = 0, pairs = 0
for (const s of SCHEMAS) {
  const core = createVerdict(structuredClone(s), {})
  const small = createSmall(structuredClone(s), {})
  assert.ok(small, 'small engine builds ' + JSON.stringify(s))
  if (core === null) continue
  built++
  for (const a of ARRAYS) {
    const want = small.isValid(a)
    assert.strictEqual(core(a), want, JSON.stringify(s) + ' on ' + show(a))
    // Twice: the item code is read on the first call.
    assert.strictEqual(core(a), want, JSON.stringify(s) + ' on ' + show(a) + ' again')
    pairs++
  }
}
assert.ok(built >= SCHEMAS.length - 5, 'core builds the schemas: ' + built + ' of ' + SCHEMAS.length)

// The first call can be on any array: an empty one, a short one, one that
// fails before the tail.
for (const s of SCHEMAS) {
  for (const first of [[], [1], ['a'], 'x', [NaN]]) {
    const core = createVerdict(structuredClone(s), {})
    if (core === null) continue
    const small = createSmall(structuredClone(s), {})
    core(first)
    for (const a of ARRAYS.slice(0, 200)) assert.strictEqual(core(a), small.isValid(a), JSON.stringify(s) + ' after ' + show(first) + ' on ' + show(a))
  }
}

function show (a) {
  if (!Array.isArray(a)) return JSON.stringify(a)
  const parts = []
  for (let i = 0; i < a.length; i++) {
    if (!(i in a)) { parts.push('<hole>'); continue }
    const x = a[i]
    parts.push(typeof x === 'number' ? (Object.is(x, -0) ? '-0' : String(x)) : JSON.stringify(x))
  }
  return '[' + parts.join(', ') + ']'
}

console.log(`core array general: ${built} schemas, ${pairs} pairs against the small engine, 0 differences`)
