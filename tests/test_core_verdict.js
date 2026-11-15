'use strict'

// The verdict core (lib/core/verdict.js) against the interpreter's walk: for
// every schema the core takes, the same verdict on every document of every
// group of the official suite in every dialect, with the schema and the
// arguments exactly as the Validator hands them to the interpreter. A schema
// it declines is counted per dialect, never guessed. Where the walk throws,
// the core must throw too. Then mutation checks: cores built to ignore
// `required`, `additionalProperties: false` or a numeric bound must fail
// this comparison.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const im = require('../lib/interpreter.js')

const real = im.createInterpreter
let cap = null
im.createInterpreter = (schema, args) => { cap = { schema, args }; return real(schema, args) }
const { Validator } = require('..')

// Every case as [schema, args, documents, label], captured once.
const cases = []
function capture (schema, data, label, options) {
  cap = null
  let v
  try { v = new Validator(schema, { engine: 'interpreter', useDefaults: false, ...options }); v.isValidObject(null) } catch { return }
  // A schema simple enough for the Validator's first-call path builds the
  // interpreter only when a value fails; the documents are offered until one
  // does. A schema none of them fails is counted, not compared.
  for (let i = 0; cap === null && i < data.length; i++) try { v.validate(data[i]) } catch {}
  if (cap !== null) cases.push({ schema: cap.schema, args: cap.args, data, label })
  else uncaptured++
}
let uncaptured = 0

const SUITE = path.join(__dirname, 'suite/tests')
for (const dialect of fs.readdirSync(SUITE)) {
  for (const sub of ['', 'optional', 'optional/format']) {
    const dir = path.join(SUITE, dialect, sub)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        if (JSON.stringify(g.schema).includes('localhost:1234')) continue
        const label = `${dialect}/${sub ? sub + '/' : ''}${f}: ${g.description}`
        const data = g.tests.map((t) => t.data)
        capture(g.schema, data, label, {})
        capture(g.schema, data, label + ' (assertFormat: false)', { assertFormat: false })
      }
    }
  }
}

// Values JSON cannot hold, and shapes the suite does not reach.
const hidden = Object.defineProperty({ a: 1 }, 'b', { value: 'x', enumerable: false })
const hiddenOk = Object.defineProperty({ a: 'x' }, 'b', { value: 2, enumerable: false })
const cyc = { a: {} }; cyc.a.next = cyc
const odd = [hidden, hiddenOk, Object.create({ a: 1 }), Object.create({ a: 'x', z: 1 }), { a: undefined }, { __proto__: null, c: 1 }, { __proto__: null, a: 'x' }, [undefined], NaN, Infinity, -0, undefined, () => 1, new Date(0), cyc]
const extra = [
  [{ properties: { a: { type: 'string' }, b: { type: 'integer' } }, additionalProperties: false }, odd, 'values JSON cannot hold'],
  [{ type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a'] }, odd, 'declared, open'],
  [{ type: 'object', properties: { a: { const: 'x' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false }, odd, 'declared, closed, all required'],
  [{ required: ['a', 'toString'], properties: { a: {} } }, [{ a: undefined }, {}, { toString: 1 }, { a: 1, toString: undefined }], 'required and undefined'],
  [{ properties: { next: { $ref: '#' }, a: { $ref: '#' } } }, odd, 'recursive through cyclic data'],
  [{ $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a', type: 'object' }, [{}, 1, cyc], 'a reference cycle that reads no data'],
  [{ anyOf: [{ type: 'object', properties: { k: { const: 'a' }, v: { type: 'string' } }, required: ['k'] }, { type: 'object', properties: { k: { const: 'b' }, v: { type: 'integer' } }, required: ['k', 'v'] }] }, [{ k: 'a', v: 's' }, { k: 'a', v: 1 }, { k: 'b', v: 1 }, { k: 'b' }, { k: 'c' }, { k: 1 }, Object.create({ k: 'a' }), 'a', null, []], 'tagged union'],
  [{ oneOf: [{ type: 'object', properties: { k: { const: 'a' } }, required: ['k'] }, { type: 'object', properties: { k: { const: 'b' } }, required: ['k'] }] }, [{ k: 'a' }, { k: 'b' }, { k: 'c' }, {}], 'tagged oneOf'],
  [{ type: 'object', minProperties: 1, maxProperties: 2, patternProperties: { '^x': { type: 'integer' } }, additionalProperties: { type: 'string' }, propertyNames: { maxLength: 3 } }, [{}, { x: 1 }, { x: 's' }, { y: 's' }, { y: 1 }, { xa: 1, y: 's', z: 's' }, { long: 's' }, Object.create({ x: 's' }), hidden], 'patterns and counts'],
  [{ type: 'array', items: { const: 'a' }, maxItems: 3 }, [[], ['a'], ['a', 'b'], ['a', 'a', 'a', 'a'], [undefined]], 'array of a constant'],
  [{ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'integer' }, contains: { type: 'integer', minimum: 5 }, minContains: 2, maxContains: 3, uniqueItems: true }, [['a', 5, 6], ['a', 5], ['a', 5, 6, 7, 8], ['a', 5, 5], [1, 5, 6]], 'array keywords'],
  [{ dependentRequired: { a: ['b'] }, dependentSchemas: { c: { required: ['d'] } } }, [{}, { a: 1 }, { a: 1, b: 1 }, { c: 1 }, { c: 1, d: 1 }, hidden], 'dependencies'],
  [{ properties: Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['p' + i, { type: 'integer' }])), required: ['p0', 'p39'], additionalProperties: false }, [{ p0: 1, p39: 2 }, { p0: 1 }, { p0: 1, p39: 2, p20: 's' }, { p0: 1, p39: 2, q: 1 }, Object.defineProperty({ p0: 1, p39: 2 }, 'p5', { value: 's' })], 'forty properties'],
  [{ type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 3 }, x: { type: 'number', maximum: 2 }, s: { type: 'string', minLength: 1, maxLength: 2 }, e: { type: 'string', enum: ['a', 'b'] } }, required: ['n'], additionalProperties: false }, [{ n: 2 }, { n: 0 }, { n: 1.5 }, { n: 2, x: 2.5 }, { n: 2, s: '' }, { n: 2, s: '\ud83d\ude00\ud83d\ude00' }, { n: 2, s: 'abc' }, { n: 2, e: 'c' }, Object.defineProperty({ n: 2 }, 's', { value: 'abc' }), Object.defineProperty({}, 'n', { value: 2, enumerable: false }), Object.create({ n: 2 }), Object.assign(Object.create({ s: 'abc' }), { n: 2 })], 'leaf codes in place'],
  [{ $defs: { a: { type: 'object', properties: { x: { type: 'string' }, y: {} }, required: ['x'], additionalProperties: false } }, oneOf: [{ $ref: '#/$defs/a' }, { properties: { z: { type: 'integer' }, y: {} }, additionalProperties: false }] }, [{ x: 's' }, { x: 1 }, { z: 1 }, { z: 's' }, { y: 1 }, {}, { q: 1 }, { x: 's', z: 1 }, Object.create({ x: 's' }), Object.create({ q: 1 }), Object.assign(Object.create({ z: 1 }), {}), 'x', []], 'oneOf of closed objects'],
  [{ anyOf: [{ properties: { a: { type: 'string' } }, additionalProperties: false }, { properties: { b: { type: 'string' } }, required: ['b'], additionalProperties: false }] }, [{ a: 's' }, { a: 1 }, { b: 's' }, { b: 1 }, {}, { c: 1 }, Object.create({ c: 1 }), Object.create({ a: 1 }), 1], 'anyOf of closed objects'],
  [{ type: 'array', items: { type: 'integer', minimum: 0 } }, [[0, 1], [-1], [1.5], ['1']], 'array of bounded integers'],
  [{ anyOf: [{ type: 'number' }, { type: 'null', description: 'none' }] }, [1, null, 'x', NaN, Infinity], 'union of types'],
  [{ type: 'integer', enum: [1, 2.5, 'x'] }, [1, 2.5, 'x', 2], 'enum and type'],
]
for (const [schema, data, label] of extra) capture(schema, data, label, {})
capture({ type: 'string', format: 'even' }, ['ab', 'abc', 1], 'caller format', { formats: { even: (s) => s.length % 2 === 0 } })
capture({ type: 'array', items: { $ref: 'https://example.com/item' } }, [[{ n: 1 }], [{ n: 'x' }]], 'registered schema', { schemas: [{ $id: 'https://example.com/item', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }] })

const dialectOf = (label) => label.split('/')[0].split(':')[0]

// Runs every case through `make`; returns the number of documents on which
// it disagreed with the walk (or throws on the first when `strict`).
function run (make, strict) {
  const taken = {}; const declined = {}; let docs = 0; let differ = 0
  for (const c of cases) {
    const d = dialectOf(c.label)
    const walk = real(c.schema, { ...c.args, tier: Infinity })
    const core = make(c.schema, c.args)
    if (core === null) { declined[d] = (declined[d] || 0) + 1; continue }
    taken[d] = (taken[d] || 0) + 1
    for (const x of c.data) {
      docs++
      let want; try { want = walk.validate(x).valid } catch (e) { want = e }
      let got; try { got = core(x) } catch (e) { got = e }
      const same = want instanceof Error ? got instanceof Error : got === want
      if (!same) {
        differ++
        if (strict) assert.fail(`${c.label}: ${String(JSON.stringify(x)).slice(0, 100)}: core ${got}, walk ${want}`)
      }
    }
  }
  return { taken, declined, docs, differ }
}

const { createVerdict } = require('../lib/core/verdict.js')
const r = run(createVerdict, true)
const all = new Set([...Object.keys(r.taken), ...Object.keys(r.declined)])
for (const d of [...all].sort()) if (fs.existsSync(path.join(SUITE, d))) console.log(`  ${d.padEnd(14)} taken ${String(r.taken[d] || 0).padStart(4)}  declined ${String(r.declined[d] || 0).padStart(4)}`)
const taken = Object.values(r.taken).reduce((a, b) => a + b, 0)
const declined = Object.values(r.declined).reduce((a, b) => a + b, 0)
assert.ok(taken > 3000 && r.docs > 15000, `${taken} schemas taken, ${r.docs} documents`)

// Mutations: the same core with one keyword stripped from every schema it is
// given. Each must disagree with the walk somewhere, or this test could not
// see that keyword ignored.
const strip = (pred, edit) => {
  const walk = (s) => {
    if (s === null || typeof s !== 'object') return s
    if (Array.isArray(s)) return s.map(walk)
    const o = {}
    for (const k of Object.keys(s)) if (!pred(k, s[k], s)) o[k] = walk(s[k]); else if (edit) o[k] = edit(s[k])
    return o
  }
  return (schema, args) => {
    try { return createVerdict(walk(schema), args) } catch { return null }
  }
}
const mutations = [
  ['required ignored', strip((k) => k === 'required')],
  ['additionalProperties: false ignored', strip((k, v) => k === 'additionalProperties' && v === false)],
  ['minimum ignored', strip((k, v) => k === 'minimum' && typeof v === 'number')],
  ['maximum off by one', strip((k, v) => k === 'maximum' && typeof v === 'number', (v) => v + 1)],
]
for (const [name, make] of mutations) {
  const m = run(make, false)
  assert.ok(m.differ > 0, `mutation "${name}" went unnoticed`)
  console.log(`  mutation ${name}: caught on ${m.differ} documents`)
}

console.log(`test_core_verdict: ok, ${taken} schemas taken, ${declined} declined, ${r.docs} documents as the interpreter's walk; ${uncaptured} schemas no document of which made the Validator build its interpreter`)
