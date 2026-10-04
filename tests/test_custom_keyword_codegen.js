'use strict'

// Custom keywords compile into the generated verdict function as calls to the
// caller's functions. Before, any schema using one ran on the interpreted
// engine, which made a strict request body about eleven times slower the
// moment it gained a single custom check. This holds the compiled form to the
// interpreted engine, which is the reference for keyword semantics, on random
// schemas that put keywords in every applicator, in both definition forms,
// typed and untyped, and under $ref, including a schema registered next to the
// root. It compares every entry point a caller reaches: the verdict, validate()
// with its errors, validateJSON and the buffer path. A compiled path that
// dropped a keyword would accept what the interpreter rejects, so the test
// counts accepted documents and rejected ones per keyword position, and how
// many schemas actually compiled, so it cannot pass by declining them all.

const assert = require('node:assert')
const { Validator } = require('..')

let seed = 0x2545f491
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]

// Keyword functions. Each is pure, and two of them leave error objects on
// themselves, which the interpreter reads and the compiled check must clear.
function evenValidate (s, d) { return !s || d % 2 === 0 }
function prefixValidate (s, d) {
  if (d.startsWith(s)) return true
  prefixValidate.errors = [{ keyword: 'prefix', message: `must start with ${s}`, params: { prefix: s } }]
  return false
}
const KEYWORDS = {
  even: { type: 'number', validate: evenValidate },
  prefix: { type: 'string', validate: prefixValidate },
  maxKeys: { type: 'object', compile: (n) => (d) => Object.keys(d).length <= n },
  notNull: (s, d) => !s || d !== null,
  range: {
    type: ['number', 'string'],
    compile: ([lo, hi]) => (d) => {
      const n = typeof d === 'string' ? d.length : d
      return n >= lo && n <= hi
    },
  },
}

function leaf (depth) {
  const r = rnd()
  if (r < 0.18) return { type: 'integer', even: true }
  if (r < 0.32) return { type: 'string', prefix: pick(['a', 'ab', 'x']) }
  if (r < 0.42) return { notNull: true }
  if (r < 0.52) return { range: pick([[0, 3], [2, 10], [5, 6]]) }
  if (r < 0.6) return { type: ['integer', 'string'], even: true, prefix: 'a' }
  if (r < 0.68) return { type: 'integer', minimum: 0 }
  if (depth > 2) return { type: 'string' }
  return node(depth + 1)
}

function node (depth) {
  const r = rnd()
  if (r < 0.25) {
    const props = {}
    const n = 1 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) props['p' + i] = leaf(depth)
    const s = { type: 'object', properties: props }
    if (rnd() < 0.4) s.maxKeys = 2 + Math.floor(rnd() * 2)
    if (rnd() < 0.3) s.required = ['p0']
    if (rnd() < 0.3) s.additionalProperties = leaf(depth)
    if (rnd() < 0.2) s.patternProperties = { '^x': leaf(depth) }
    return s
  }
  if (r < 0.4) return { type: 'array', items: leaf(depth), ...(rnd() < 0.3 ? { contains: leaf(depth) } : {}) }
  if (r < 0.5) return { anyOf: [leaf(depth), leaf(depth)] }
  if (r < 0.6) return { oneOf: [leaf(depth), leaf(depth)] }
  if (r < 0.68) return { not: leaf(depth) }
  if (r < 0.78) return { if: leaf(depth), then: leaf(depth), else: leaf(depth) }
  if (r < 0.88) return { allOf: [leaf(depth), { notNull: true }] }
  const name = 'd' + Object.keys(DEFS).length
  DEFS[name] = leaf(depth + 1)
  return { $ref: '#/$defs/' + name }
}
// Definitions are collected at the root, where `#/$defs/...` resolves.
let DEFS = {}
function rootSchema () {
  DEFS = {}
  const s = node(0)
  const root = typeof s === 'object' && s !== null ? { ...s } : s
  if (Object.keys(DEFS).length) root.$defs = DEFS
  return root
}

const VALUES = [0, 1, 2, 3, 4, 7, 10, -2, 2.5, '', 'a', 'ab', 'abc', 'xyz', 'abcdefghijk', null, true, false]
function doc (depth) {
  const r = rnd()
  if (depth > 2 || r < 0.45) return pick(VALUES)
  if (r < 0.75) {
    const o = {}
    const n = Math.floor(rnd() * 4)
    for (let i = 0; i < n; i++) o[pick(['p0', 'p1', 'p2', 'x1', 'q', 'a', 'b'])] = doc(depth + 1)
    return o
  }
  return Array.from({ length: Math.floor(rnd() * 4) }, () => doc(depth + 1))
}

const shape = (r) => r.valid ? 'valid' : 'invalid:' + r.errors.map((e) => e.keyword + '@' + e.instancePath).sort().join(',')

let schemas = 0, compiled = 0, accepted = 0, rejected = 0, compared = 0
const diffs = []
function check (schema, label, extra) {
  schemas++
  const opts = { keywords: KEYWORDS, ...(extra || {}) }
  const v = new Validator(schema, opts)
  const ref = new Validator(schema, { ...opts, engine: 'interpreter' })
  for (let i = 0; i < 24; i++) {
    const d = doc(0)
    const text = JSON.stringify(d)
    const want = ref.validate(JSON.parse(text))
    const got = v.validate(JSON.parse(text))
    if (want.valid) accepted++; else rejected++
    const answers = [
      ['validate', shape(got), shape(want)],
      ['isValidObject', v.isValidObject(JSON.parse(text)), want.valid],
      ['validateJSON', v.validateJSON(text).valid, want.valid],
      ['isValidJSON', v.isValidJSON(text), want.valid],
      ['isValid(buffer)', v.isValid(Buffer.from(text)), want.valid],
    ]
    for (const [path, a, b] of answers) {
      compared++
      if (a !== b && diffs.length < 15) diffs.push(`${label} ${path} on ${text}: ${a} vs interpreter ${b}\n  schema ${JSON.stringify(schema)}`)
      else if (a !== b) diffs.push(1)
    }
    // Reading errors a second time, after a rejection switched the validator
    // to its error path, must not change the verdict.
    compared++
    if (v.validate(JSON.parse(text)).valid !== want.valid) diffs.push(`${label} second validate on ${text}`)
  }
  if (v.engine() === 'codegen') compiled++
}

for (let i = 0; i < 400; i++) check(rootSchema(), `schema ${i}`)

// A keyword used only in a schema reached through $ref to another document,
// with none in the root. Until this change the root alone decided whether
// keywords were in use, so every compiled path skipped the referenced one and
// accepted what it rejects. The root here is kept free of keywords on purpose.
const EXT_LEAVES = [
  () => ({ type: 'integer', even: true }),
  () => ({ type: 'string', prefix: pick(['a', 'ab', 'x']) }),
  () => ({ notNull: true }),
  () => ({ range: pick([[0, 3], [2, 10]]) }),
  () => ({ type: 'object', maxKeys: 1 }),
]
const extDocs = [3, 4, 0, 'a', 'b', 'abc', null, 1, 12, {}, { q: 1, r: 2 }]
let extRejectedByKeyword = 0
for (let i = 0; i < 60; i++) {
  const ext = { $id: 'https://example.test/ext' + i, ...pick(EXT_LEAVES)() }
  const schema = { type: 'object', properties: { a: { $ref: ext.$id }, b: { type: 'string' } } }
  check(schema, `external ${i}`, { schemas: [ext] })
  const v = new Validator(schema, { keywords: KEYWORDS, schemas: [ext] })
  const ref = new Validator(schema, { keywords: KEYWORDS, schemas: [ext], engine: 'interpreter' })
  for (const a of extDocs) {
    const d = { a }
    const want = ref.validate(d).valid
    if (!want) extRejectedByKeyword++
    for (const got of [v.validate(d).valid, v.isValidObject(d), v.validateJSON(JSON.stringify(d)).valid, v.validate(d).valid]) {
      compared++
      if (got !== want) diffs.push(`external ${i} on ${JSON.stringify(d)}: ${got} vs interpreter ${want}, ext ${JSON.stringify(ext)}`)
    }
  }
}
assert.ok(extRejectedByKeyword >= 150, `the external keyword rejected too few documents: ${extRejectedByKeyword}`)

if (diffs.length) {
  console.log(diffs.filter((d) => d !== 1).join('\n'))
  assert.fail(`${diffs.length} answers differ from the interpreted engine`)
}
assert.ok(compiled >= schemas * 0.8, `too few schemas compiled: ${compiled} of ${schemas}`)
assert.ok(accepted >= 1500 && rejected >= 1500, `too few of one verdict: ${accepted} accepted, ${rejected} rejected`)

// The generator's copies of the interpreter's type bits must stay equal.
{
  const { kwTypeBit, kwDataBits, KW_T_ANY } = require('../lib/js-compiler')._kwTypeBits
  const { typeBit, dataBits, T_ANY } = require('../lib/interpreter')._planInternals
  assert.strictEqual(KW_T_ANY, T_ANY)
  for (const t of ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array', 'unknown', '']) assert.strictEqual(kwTypeBit(t), typeBit(t), t)
  for (const d of ['', 'a', 0, -0, 1, 1.5, -2, NaN, Infinity, -Infinity, 2 ** 53, true, false, null, {}, [], undefined, () => 1, 10n]) {
    assert.strictEqual(kwDataBits(d), dataBits(d), String(d))
  }
}

// Error objects a keyword function leaves on itself are cleared after the
// compiled call, as the interpreter clears them, so they cannot leak into a
// later error report.
{
  const v = new Validator({ type: 'string', prefix: 'a' }, { keywords: KEYWORDS })
  assert.strictEqual(v.isValidObject('b'), false)
  assert.strictEqual(prefixValidate.errors, null, 'errors cleared after the compiled call')
  const r = v.validate('b')
  assert.deepStrictEqual(r.errors.map((e) => [e.keyword, e.message]), [['prefix', 'must start with a']])
}

// A macro keyword stays on the interpreted engine, with its answers.
{
  const v = new Validator({ type: 'object', small: 2 }, { keywords: { small: { macro: (n) => ({ maxProperties: n }) } } })
  assert.strictEqual(v.validate({ a: 1, b: 2, c: 3 }).valid, false)
  assert.strictEqual(v.engine(), 'interpreter')
}

// A function bound to one validator's keywords is not shared through the
// compile cache with a validator of the same schema and other keywords.
{
  const schema = { type: 'integer', parity: true }
  const even = new Validator(schema, { keywords: { parity: (s, d) => d % 2 === 0 } })
  const odd = new Validator(JSON.parse(JSON.stringify(schema)), { keywords: { parity: (s, d) => d % 2 === 1 } })
  const plain = new Validator(JSON.parse(JSON.stringify(schema)))
  assert.deepStrictEqual([even.isValidObject(2), odd.isValidObject(2), plain.isValidObject(3)], [true, false, true])
}

console.log(`ok: custom keywords compile and agree with the interpreter (${schemas} schemas, ${compiled} compiled, ${compared} answers, ${accepted} accepted, ${rejected} rejected)`)
