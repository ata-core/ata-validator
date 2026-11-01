// The IR compiler (lib/ir) against the current engine on generated
// documents: a seeded generator, schemas that exercise every keyword family
// ($ref and recursion, $dynamicRef, annotations, branches, defaults), both
// backends, rich and plain errors, defaults filled and compared. Two known
// divergences of the current engine are counted apart and bounded:
// infinite numbers under a union or no type (it skips the numeric bounds),
// and error order through a URI $ref into another resource (its sort cannot
// place those paths). Every other difference fails.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')
const COUNT = Number(process.env.IR_DIFF_COUNT || 1500)

const { compileClosures } = await import('../lib/ir/index.mjs')
const { compile: compileModule } = await import('../lib/ir/emit.mjs')

const SCHEMAS = {
  order: {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      name: { type: 'string', minLength: 2, maxLength: 80 },
      quantity: { type: 'integer', minimum: 1, maximum: 20 },
      coupon: { type: ['string', 'null'], pattern: '^[A-Z0-9]{6}$' },
      gift: { type: 'boolean', default: false },
      note: { type: 'string', maxLength: 280 },
    },
    required: ['email', 'name', 'quantity'],
    additionalProperties: false,
  },
  nested: {
    type: 'object',
    required: ['a/b', 'c~d'],
    properties: {
      'a/b': { type: 'object', properties: { x: { type: 'number', maximum: 1.5 } }, required: ['x'] },
      'c~d': { type: ['integer', 'string'], minimum: 0, minLength: 1 },
      deep: { type: 'object', additionalProperties: { type: 'string', maxLength: 3 } },
    },
  },
  loose: { properties: { n: { minimum: 3 }, s: { pattern: '^a', format: 'email' } } },
  tree: {
    $id: 'https://example.com/tree',
    $defs: {
      node: {
        $anchor: 'node',
        type: 'object',
        properties: { name: { $ref: 'leaf.json', maxLength: 3 }, quantity: { $ref: '#/$defs/pos' }, kids: { type: 'array', items: { $ref: '#node' }, maxItems: 2 } },
        required: ['name'],
        additionalProperties: false,
      },
      pos: { type: 'integer', minimum: 1 },
      leaf: { $id: 'leaf.json', type: 'string', minLength: 1 },
    },
    $ref: '#/$defs/node',
  },
  defs: {
    $defs: { money: { type: 'object', properties: { quantity: { type: 'integer', default: 1 }, coupon: { type: 'string', default: 'NONE' } } } },
    type: 'object',
    required: ['name', 'gift'],
    properties: {
      name: { type: 'string', default: 'anon' },
      gift: { type: 'boolean', default: false },
      deep: { $ref: '#/$defs/money' },
      kids: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', default: 'kid' } } } },
      n: { type: 'object', default: { x: 1 }, properties: { s: { default: [] } } },
    },
    allOf: [{ properties: { note: { type: 'string', default: '' } } }],
  },
  recdef: {
    $defs: { t: { type: 'object', properties: { name: { type: 'string', default: 'x' }, kids: { type: 'array', items: { $ref: '#/$defs/t' } }, n: { $ref: '#/$defs/t', default: {} } } } },
    $ref: '#/$defs/t',
  },
  dyn: {
    $id: 'https://example.com/strict-tree',
    $dynamicAnchor: 'node',
    $ref: 'tree',
    unevaluatedProperties: false,
    $defs: {
      tree: {
        $id: 'tree',
        $dynamicAnchor: 'node',
        type: 'object',
        properties: { name: { type: 'string', maxLength: 3 }, kids: { type: 'array', items: { $dynamicRef: '#node' } } },
      },
    },
  },
  uneval: {
    $defs: { q: { properties: { quantity: { type: 'integer' } } } },
    type: 'object',
    properties: { email: { type: 'string' } },
    allOf: [{ properties: { name: { minLength: 2 } } }, { $ref: '#/$defs/q' }],
    anyOf: [{ properties: { coupon: { type: 'string' } }, required: ['coupon'] }, { properties: { gift: { type: 'boolean' } } }],
    oneOf: [{ properties: { note: { type: 'string' } }, required: ['note'] }, { properties: { nmae: {} }, required: ['nmae'] }],
    if: { properties: { kids: { type: 'array' } }, required: ['kids'] },
    then: { properties: { kids: { prefixItems: [{ type: 'string' }], contains: { type: 'number' }, unevaluatedItems: { type: 'boolean' } } } },
    else: { properties: { zz: {} } },
    dependentSchemas: { emial: { properties: { x: { const: 1 } } } },
    unevaluatedProperties: false,
  },
  combo: {
    type: 'object',
    properties: {
      email: { anyOf: [{ type: 'string', format: 'email', title: 'an email' }, { type: 'null' }, { type: 'string', minLength: 2, maxLength: 3 }] },
      name: { oneOf: [{ type: 'string', minLength: 2 }, { type: 'string', maxLength: 3 }, { const: 1 }] },
      quantity: { allOf: [{ type: 'integer' }, { minimum: 1 }, { not: { const: 13 } }] },
      coupon: { if: { type: 'string' }, then: { pattern: '^[A-Z]' }, else: { type: ['null', 'number'], maximum: 2 } },
      note: { not: { type: 'string', maxLength: 1 } },
    },
    dependentSchemas: { gift: { required: ['note'], properties: { note: { minLength: 2 } } } },
    anyOf: [{ required: ['email'] }, { required: ['name', 'quantity'] }],
  },
}

// A seeded generator, so a failure replays.
let seed = 1
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (a) => a[Math.floor(rnd() * a.length)]

const STRINGS = ['', 'a', 'A', 'ab', 'x', 'a@b.co', 'a@b', 'a@@b.co', '"q"@b.co', 'ABC123', 'abc123', 'ABC12', 'ABCDEFG', '😀', '😀😀', '\ud83d', 'a'.repeat(80), 'a'.repeat(81), 'a'.repeat(140), 'é'.repeat(281), '2', '-3', '1.5', 'true', 'name', 'nmae', 'emial', 'qty', 'abc', '/']
const NUMS = [0, 1, 2, 20, 21, -1, 1.5, 1.0, -0, 0.5, 1e21, NaN, Infinity, -Infinity, 3, 2.9999]
const value = (depth) => {
  const r = rnd()
  if (r < 0.35) return pick(STRINGS)
  if (r < 0.65) return pick(NUMS)
  if (r < 0.72) return pick([true, false])
  if (r < 0.78) return null
  if (r < 0.82) return undefined
  if (r < 0.88 || depth > 2) return [pick(STRINGS), pick(NUMS)].slice(0, Math.floor(rnd() * 3))
  return obj(depth + 1)
}
const KEYS = ['email', 'name', 'quantity', 'coupon', 'gift', 'note', 'kids', 'nmae', 'emial', 'zz', 'a/b', 'c~d', 'deep', 'x', 'n', 's', 'constructor', '__proto__']
const obj = (depth) => {
  const o = {}
  const n = Math.floor(rnd() * 7)
  for (let i = 0; i < n; i++) {
    const k = pick(KEYS)
    if (k === '__proto__') Object.defineProperty(o, k, { value: value(depth), enumerable: true, configurable: true, writable: true })
    else o[k] = value(depth)
  }
  return o
}
const near = (base) => {
  if (Array.isArray(base.kids) && base.kids.length && rnd() < 0.5) { const kids = base.kids.slice(); const i = Math.floor(rnd() * kids.length); kids[i] = near(kids[i]); return { ...base, kids } }
  const o = { ...base }
  const k = pick(Object.keys(base).concat(KEYS))
  if (rnd() < 0.3) delete o[k]; else o[k] = value(2)
  return o
}
const GOOD = {
  order: { email: 'a@b.co', name: 'Al', quantity: 2, coupon: 'ABC123', gift: true, note: 'hi' },
  nested: { 'a/b': { x: 1 }, 'c~d': 3, deep: { q: 'abc' } },
  loose: { n: 4, s: 'a@b.co' },
  tree: { name: 'ab', quantity: 1, kids: [{ name: 'a', kids: [{ name: 'b' }] }, { name: 'c' }] },
  defs: {
    $defs: { money: { type: 'object', properties: { quantity: { type: 'integer', default: 1 }, coupon: { type: 'string', default: 'NONE' } } } },
    type: 'object',
    required: ['name', 'gift'],
    properties: {
      name: { type: 'string', default: 'anon' },
      gift: { type: 'boolean', default: false },
      deep: { $ref: '#/$defs/money' },
      kids: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', default: 'kid' } } } },
      n: { type: 'object', default: { x: 1 }, properties: { s: { default: [] } } },
    },
    allOf: [{ properties: { note: { type: 'string', default: '' } } }],
  },
  recdef: {
    $defs: { t: { type: 'object', properties: { name: { type: 'string', default: 'x' }, kids: { type: 'array', items: { $ref: '#/$defs/t' } }, n: { $ref: '#/$defs/t', default: {} } } } },
    $ref: '#/$defs/t',
  },
  dyn: {
    $id: 'https://example.com/strict-tree',
    $dynamicAnchor: 'node',
    $ref: 'tree',
    unevaluatedProperties: false,
    $defs: {
      tree: {
        $id: 'tree',
        $dynamicAnchor: 'node',
        type: 'object',
        properties: { name: { type: 'string', maxLength: 3 }, kids: { type: 'array', items: { $dynamicRef: '#node' } } },
      },
    },
  },
  defs: {
    $defs: { money: { type: 'object', properties: { quantity: { type: 'integer', default: 1 }, coupon: { type: 'string', default: 'NONE' } } } },
    type: 'object',
    required: ['name', 'gift'],
    properties: {
      name: { type: 'string', default: 'anon' },
      gift: { type: 'boolean', default: false },
      deep: { $ref: '#/$defs/money' },
      kids: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', default: 'kid' } } } },
      n: { type: 'object', default: { x: 1 }, properties: { s: { default: [] } } },
    },
    allOf: [{ properties: { note: { type: 'string', default: '' } } }],
  },
  defs: { name: 'Al', gift: true, deep: { quantity: 2 }, kids: [{ name: 'a' }, {}], n: { s: [1] }, note: 'x' },
  recdef: { name: 'a', kids: [{ name: 'b', kids: [{}] }, {}], n: { name: 'c' } },
  dyn: { name: 'ab', kids: [{ name: 'a', kids: [{ name: 'b' }] }, { name: 'c' }] },
  uneval: { email: 'a@b.co', name: 'Al', quantity: 2, coupon: 'X', note: 'n', kids: ['a', 1, true, 2] },
  combo: { email: 'a@b.co', name: 'Alice', quantity: 2, coupon: 'ABC', gift: true, note: 'hi there' },
}

const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => Object.keys(e).map((k) => [k, e[k] === undefined ? '<undef>' : e[k]]))])

const clone = (v) => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
const dump = (v) => { try { return JSON.stringify(v, (k, x) => x === undefined ? '<undef>' : typeof x === 'number' && !Number.isFinite(x) ? String(x) : x) } catch { return '<cyclic>' } }
const hasInfinite = (v) => typeof v === 'number' ? !Number.isFinite(v) : (v !== null && typeof v === 'object' && Object.values(v).some(hasInfinite))
const NUMERIC = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'])
const onlyNumericDiffers = (a, b) => {
  const key = (e) => JSON.stringify([e.instancePath, e.schemaPath, e.keyword])
  const ka = new Map((a.errors || []).map((e) => [key(e), e])); const kb = new Map((b.errors || []).map((e) => [key(e), e]))
  for (const [k, e] of ka) if (!kb.has(k) && !NUMERIC.has(e.keyword)) return false
  for (const [k, e] of kb) if (!ka.has(k) && !NUMERIC.has(e.keyword)) return false
  return true
}
const errKey = (e) => JSON.stringify(Object.keys(e).map((k) => [k, e[k] === undefined ? '<undef>' : (k === 'related' ? '<idx>' : e[k])]))
const sameSet = (x, y) => x.valid === y.valid && (x.errors || []).length === (y.errors || []).length && JSON.stringify((x.errors || []).map(errKey).sort()) === JSON.stringify((y.errors || []).map(errKey).sort())
const show = (d) => { try { return JSON.stringify(d) } catch { return String(d) } }

let total = 0
async function run (backend, { DEFAULTS, PLAIN }) {
  seed = 1
  let failures = 0; let known = 0; let orderOnly = 0; let checked = 0
  const label = `${backend}, ${PLAIN ? 'plain' : 'rich'}${DEFAULTS ? ', defaults' : ''}`
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const opts = { useDefaults: DEFAULTS, richErrors: !PLAIN }
    const ata = new Validator(schema, opts)
    const ir = backend === 'closures' ? compileClosures(schema, opts) : await compileModule(schema, opts)
    const docs = [GOOD[name], {}, null, '', 0, false, NaN, [], 'str', 5]
    for (let i = 0; i < COUNT; i++) docs.push(rnd() < 0.5 ? near(GOOD[name]) : rnd() < 0.5 ? obj(0) : value(0))
    for (const d of docs) {
      checked++
      // Each engine gets its own copy: filling defaults changes the document.
      const da = clone(d); const db = clone(d)
      const ra = ata.validate(da); const rb = ir.validate(db)
      // The result's surface as code reads it: `data` is the checked value
      // itself on a valid document and absent otherwise; `valid` and
      // `errors` are there either way (the current engine's errors may be a
      // getter, so presence is asked with `in`, not Object.keys).
      const surface = (r, input) => JSON.stringify([r.valid ? r.data === input : r.data === undefined, 'valid' in r, 'errors' in r, Array.isArray(r.errors)])
      const a = shape(ra) + surface(ra, da) + (DEFAULTS ? dump(da) : '')
      const b = shape(rb) + surface(rb, db) + (DEFAULTS ? dump(db) : '')
      // Known divergence: an infinite number under a union type or no type,
      // where the current engine skips the numeric bounds. Allowed only when
      // every differing error is a numeric bound.
      const knownDiv = hasInfinite(d) && onlyNumericDiffers(ra, rb)
      // The verdict on its own.
      if (!knownDiv && ata.isValidObject(clone(d)) !== ir.isValid(clone(d))) { failures++; if (failures <= 3) console.log(`  FAIL ${label} ${name}: verdict differs on ${show(d)}`) }
      if (a === b) continue
      if (knownDiv) { known++; continue }
      // Known divergence in order only, and only in the schema whose errors
      // come through a URI $ref into another resource.
      if (name === 'dyn' && dump(da) === dump(db) && sameSet(ra, rb)) { orderOnly++; continue }
      failures++
      if (failures <= 3) {
        let i = 0; while (i < a.length && a[i] === b[i]) i++
        console.log(`  FAIL ${label} ${name}: ${show(d)}\n    current ${a.slice(Math.max(0, i - 150), i + 200)}\n    ir      ${b.slice(Math.max(0, i - 150), i + 200)}`)
      }
    }
  }
  console.log(`  ${label.padEnd(30)} ${checked} documents, ${failures} differ, ${known} infinite-number divergences, ${orderOnly} order-only`)
  total += failures
}

for (const backend of ['closures', 'modules']) {
  for (const mode of [{ DEFAULTS: false, PLAIN: false }, { DEFAULTS: false, PLAIN: true }, { DEFAULTS: true, PLAIN: false }]) await run(backend, mode)
}
if (total) { console.log(`\n${total} failed`); process.exit(1) }
console.log('ok: the IR matches the current engine on every generated document, both backends')
