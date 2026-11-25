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
// Every schema-decided group (lib/groups.js), as the full 2.0 entries register them.
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)

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
  [{ type: 'object', properties: { name: { type: 'string' }, n: { type: 'integer' } }, required: ['name'] }, [Object.create({ name: 'x' }), Object.assign(Object.create({ name: 'x' }), { n: 1 }), Object.create({ n: 's' }), Object.assign(Object.create({ n: 's' }), { name: 'x' }), Object.defineProperty({ name: 'x' }, 'n', { value: 's' }), Object.defineProperty({}, 'name', { value: 'x' }), { name: 'x' }], 'inherited and hidden, open'],
  [{ type: 'object', properties: { name: { type: 'string' }, n: { type: 'integer' } }, required: ['name'], additionalProperties: false }, [Object.create({ name: 'x' }), Object.assign(Object.create({ z: 1 }), { name: 'x' }), Object.assign(Object.create({ n: 's' }), { name: 'x' }), Object.defineProperty({ name: 'x' }, 'n', { value: 's' }), Object.defineProperty({ name: 'x' }, 'z', { value: 1 }), { name: 'x' }], 'inherited and hidden, closed'],
  [{ type: 'object', properties: Object.fromEntries('abcdefgh'.split('').map((k) => [k, { type: 'integer' }])), required: ['a', 'h'] }, [{ a: 1, h: 1 }, { a: 1 }, Object.defineProperty({ a: 1 }, 'h', { value: 2 }), Object.defineProperty({ a: 1, h: 1 }, 'c', { value: 's' }), Object.defineProperty({ a: 1, h: 1 }, 'c', { value: 3 }), Object.assign(Object.create({ c: 's' }), { a: 1, h: 1 }), Object.defineProperty(Object.assign(Object.create({ z: 1 }), { a: 1, h: 1 }), 'd', { value: 's' })], 'eight properties, most absent'],
  [{ type: 'object', properties: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['q' + i, { type: 'integer' }])), required: ['q3'], additionalProperties: false }, [{ q3: 1 }, { q3: 1, q9: 's' }, { q9: 1 }, { q3: 1, z: 1 }, Object.defineProperty({ q3: 1 }, 'q5', { value: 's' }), Object.defineProperty({}, 'q3', { value: 1 }), Object.defineProperty({}, 'q3', { value: 's' }), Object.create({ q3: 1 }), Object.defineProperty({ q3: 1 }, 'z', { value: 1 })], 'twenty properties, walked by own names'],
  [{ $dynamicAnchor: 'x', properties: { n: { $dynamicRef: '#x' } }, unevaluatedProperties: false, anyOf: [{ properties: { a: {} } }, { properties: { b: {} }, allOf: [{ required: ['c'] }] }] }, [{ a: 1 }, { b: 1 }, { b: 1, c: 1 }, { a: 1, n: { b: 1 } }, { a: 1, n: { a: 1 } }], 'dynamic reference and a failed branch'],
  [{ $id: 'https://example.com/leave/main', if: { $id: 'first_scope', properties: { z: {} }, $defs: { thingy: { $dynamicAnchor: 'thingy', type: 'number' } } }, then: { $id: 'second_scope', $ref: 'start', $defs: { thingy: { $dynamicAnchor: 'thingy', type: 'null' } } }, $defs: { start: { $id: 'start', $dynamicRef: 'inner_scope#thingy' }, thingy: { $id: 'inner_scope', $dynamicAnchor: 'thingy', type: 'string' } } }, ['a', 42, null, true], 'a dynamic scope left behind'],
  [{ $id: 'https://example.com/r2', $dynamicAnchor: 'q', $defs: { b: { type: 'string' } }, properties: { v: { $id: 'inner/', $defs: { b: { type: 'integer' } }, properties: { x: { $ref: '#/$defs/b' } } }, w: { $dynamicRef: '#q' } }, unevaluatedProperties: false }, [{ v: { x: 1 } }, { v: { x: 's' } }, { w: { v: { x: 's' } } }, { z: 1 }], 'nested $id beside a dynamic reference'],
  [{ type: 'object', properties: { a: { $ref: 'https://nowhere.example/a' }, b: false, c: { type: 'integer' } } }, [{}, { a: 1 }, { a: undefined }, { b: null }, { c: 1 }, { c: 's' }, Object.create({ a: 1 }), Object.defineProperty({}, 'a', { value: 1 }), Object.defineProperty({}, 'b', { value: undefined })], 'properties that can never pass'],
  [{ type: 'toString' }, [1, 'x', null, NaN], 'a type named like an Object member'],
  [{ $id: 'https://example.com/root', $defs: { a: { $id: 'inner/', $defs: { b: { type: 'integer' } }, properties: { x: { $ref: '#/$defs/b' } } } }, properties: { v: { $ref: 'inner/' } } }, [{ v: { x: 1 } }, { v: { x: 's' } }, {}], 'nested $id'],
  [{ unevaluatedProperties: false, anyOf: [{ properties: { a: { type: 'string' } } }, { properties: { b: { type: 'string' } }, allOf: [{ required: ['c'] }] }] }, [{ a: 's' }, { b: 's' }, { a: 's', b: 's' }, { b: 's', c: 1 }, {}], 'unevaluated after a failed branch'],
  [{ unevaluatedItems: false, prefixItems: [{ type: 'string' }], oneOf: [{ contains: { type: 'integer' } }, { prefixItems: [true, { type: 'integer' }] }] }, [['a'], ['a', 1], ['a', 's'], ['a', 1, 1]], 'unevaluated items through oneOf and contains'],
  [{ $defs: { n: { $dynamicAnchor: 'x', type: 'object', properties: { next: { $dynamicRef: '#x' } } } }, $dynamicAnchor: 'x', $ref: '#/$defs/n', required: ['k'] }, [{ k: 1 }, { k: 1, next: { k: 1 } }, { k: 1, next: {} }, cyc], 'dynamic reference to the outermost anchor'],
  [{ properties: { a: { $ref: 'https://nowhere.example/x' } } }, [{}, { a: 1 }], 'a reference that does not resolve'],
  [{ propertyDependencies: { kind: { a: { required: ['x'] } } } }, [{ kind: 'a' }, { kind: 'a', x: 1 }, { kind: 'b' }, { kind: 1 }], 'propertyDependencies'],
  [{ type: 'array', items: { type: 'integer', minimum: 0 } }, [[0, 1], [-1], [1.5], ['1']], 'array of bounded integers'],
  [{ anyOf: [{ type: 'number' }, { type: 'null', description: 'none' }] }, [1, null, 'x', NaN, Infinity], 'union of types'],
  [{ type: 'integer', enum: [1, 2.5, 'x'] }, [1, 2.5, 'x', 2], 'enum and type'],
  // What a subschema evaluated, as unevaluated* reads it: a failed oneOf
  // branch, contains on items it does not match, contains in a failed
  // branch, a passing if without then or else.
  [{ unevaluatedProperties: false, oneOf: [{ properties: { b: {} }, allOf: [{ required: ['zz'] }] }, { properties: { a: { type: 'string' } }, required: ['a'] }] }, [{ a: 's' }, { a: 's', b: 1 }, { b: 1 }, { a: 's', zz: 1 }], 'unevaluated after a failed oneOf branch'],
  [{ unevaluatedItems: false, contains: { type: 'integer' } }, [[1], [1, 's'], ['s'], [1, 2]], 'unevaluated items and contains'],
  [{ unevaluatedItems: false, anyOf: [{ contains: { type: 'string' }, minContains: 3 }, true] }, [[], ['a', 'b'], ['a', 'b', 'c']], 'unevaluated items and contains in a failed branch'],
  [{ unevaluatedProperties: false, if: { properties: { a: { const: 1 } }, required: ['a'] } }, [{ a: 1 }, { a: 2 }, {}], 'unevaluated after a passing if'],
  [{ unevaluatedProperties: false, anyOf: [{ patternProperties: { '^x': true }, dependentSchemas: { x: { required: ['q'] } } }, true] }, [{ x: 1 }, { x: 1, q: 1 }, {}], 'unevaluated after names matched in a failed branch'],
]
for (const [schema, data, label] of extra) capture(schema, data, label, {})
capture({ type: 'string', format: 'even' }, ['ab', 'abc', 1], 'caller format', { formats: { even: (s) => s.length % 2 === 0 } })
capture({ type: 'array', items: { $ref: 'https://example.com/item' } }, [[{ n: 1 }], [{ n: 'x' }]], 'registered schema', { schemas: [{ $id: 'https://example.com/item', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }] })

const dialectOf = (label) => label.split('/')[0].split(':')[0]

// Runs every case through `make`; returns the number of documents on which
// it disagreed with the walk (or throws on the first when `strict`).
// The test's own walk for an enum or required that is not a list, through
// every value that can hold a subschema (a superset of what the core walks:
// the keyword found must be one a subschema holds).
function badShape (s, seen) {
  if (s === null || typeof s !== 'object' || seen.has(s)) return null
  seen.add(s)
  if (Array.isArray(s)) { for (const x of s) { const r = badShape(x, seen); if (r !== null) return r } return null }
  for (const k of ['enum', 'required']) if (s[k] !== undefined && s[k] !== null && !Array.isArray(s[k])) return k
  for (const k of Object.keys(s)) {
    if (k === 'enum' || k === 'const' || k === 'default' || k === 'examples') continue
    const v = s[k]
    // A map of subschemas holds them under names, which are not keywords.
    if (k === 'properties' || k === 'patternProperties' || k === '$defs' || k === 'definitions' || k === 'dependentSchemas') { if (v && typeof v === 'object') for (const x of Object.values(v)) { const r = badShape(x, seen); if (r !== null) return r } continue }
    const r = badShape(v, seen)
    if (r !== null) return r
  }
  return null
}
function run (make, strict) {
  const taken = {}; const declined = {}; let docs = 0; let differ = 0; let shaped = 0
  for (const c of cases) {
    const d = dialectOf(c.label)
    const walk = real(c.schema, { ...c.args, tier: Infinity })
    // An enum or required that is not a list (null reads as absent) is a
    // TypeError with the text every path gives, from the first one in the
    // schema; any other schema builds. Held on the main run (createVerdict);
    // the runs of one part alone leave such a schema out.
    const bad = badShape(c.schema, new Set())
    if (bad !== null && !strict) { shaped++; continue }
    let core
    try { core = make(c.schema, c.args) } catch (e) {
      if (bad === null) throw e
      assert.ok(e instanceof TypeError, c.label + ': a TypeError')
      assert.strictEqual(e.message, `invalid schema: "${bad}" must be an array`, c.label)
      shaped++
      continue
    }
    if (core === null) { declined[d] = (declined[d] || 0) + 1; continue }
    assert.strictEqual(bad, null, c.label + ': an enum or required that is not a list was not thrown')
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
  return { taken, declined, docs, differ, shaped }
}

const { createVerdict } = require('../lib/core/verdict.js')

// enum and required that are not lists: a TypeError with the text every path
// gives, wherever they are, and before anything is compiled; null is absent.
for (const [s, k] of [
  [{ enum: 'a' }, 'enum'], [{ required: 'a' }, 'required'], [{ required: true }, 'required'],
  [{ type: 'object', properties: { a: { enum: { x: 1 } } } }, 'enum'], [{ properties: { a: { required: 1 } } }, 'required'],
  [{ $defs: { x: { enum: 'a' } }, type: 'string' }, 'enum'], [{ $defs: { x: { required: 'a' } }, $ref: '#/$defs/x' }, 'required'],
  [{ allOf: [{ anyOf: [{ enum: 1 }] }] }, 'enum'], [{ $recursiveRef: '#', items: { enum: 'a' } }, 'enum'],
]) assert.throws(() => createVerdict(s, {}), (e) => e instanceof TypeError && e.message === `invalid schema: "${k}" must be an array`, JSON.stringify(s))
{
  const n = createVerdict({ enum: null, required: null, type: 'string' }, {})
  assert.deepStrictEqual(['a', 1].map(n), [true, false], 'null enum and required read as absent')
  const p = createVerdict({ properties: { enum: { type: 'string' }, required: { type: 'integer' } }, required: ['enum'] }, {})
  assert.deepStrictEqual([{ enum: 'x' }, { enum: 1 }, {}, { enum: 'x', required: 's' }].map(p), [true, false, false, false], 'properties named enum and required')
}
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
// Cores whose own source is changed so that a key for-in met is taken as
// own, or a declared property that is not enumerable is taken as absent.
// The source is compiled as a module of its own; the file is not touched.
const Module = require('node:module')
const FILE = require.resolve('../lib/core/verdict.js')
function mutant (edits) {
  let src = fs.readFileSync(FILE, 'utf8')
  for (const [from, to] of edits) { assert.ok(src.includes(from), 'mutation anchor missing: ' + from); src = src.split(from).join(to) }
  const m = new Module(FILE, module); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE)); m._compile(src, FILE)
  return m.exports.createVerdict
}
mutations.push(['inherited keys taken as own', mutant([['|| has(o, last) ||', '|| true ||'], ['if (last !== undefined && !has(o, last))', 'if (false)']])])
mutations.push(['non-enumerable properties taken as absent', mutant([['const x = has(o, k) ? o[k] : undefined', 'const x = undefined']])])
// The same for lib/core/verdict-more.js: a fresh first half loads the
// changed module, which reads that first half's internals.
let mutants = 0
function mutantMore (edits) {
  const MORE = require.resolve('../lib/core/verdict-more.js')
  let src = fs.readFileSync(MORE, 'utf8')
  for (const [from, to] of edits) { assert.ok(src.includes(from), 'mutation anchor missing: ' + from); src = src.split(from).join(to) }
  const tag = '__coreMore' + (++mutants)
  let more = null
  globalThis[tag] = () => more || (more = (() => {
    const m = new Module(MORE, module); m.filename = MORE; m.paths = Module._nodeModulePaths(path.dirname(MORE))
    m._compile(src.split("require('./verdict')").join('globalThis.' + tag + 'V'), MORE)
    return m.exports
  })())
  let first = fs.readFileSync(FILE, 'utf8').split("req('./verdict-more')").join('globalThis.' + tag + '()')
  const m = new Module(FILE, module); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE)); m._compile(first, FILE)
  globalThis[tag + 'V'] = m.exports
  return m.exports.createVerdict
}
mutations.push(['a reference in a nested $id resource resolved from the root base', mutant([['resolveOnce(st.refs[i].$ref, b, state, memo)', 'resolveOnce(st.refs[i].$ref, state.rootBase, state, memo)']])])
mutations.push(['a non-enumerable property skipped where own names are read', mutant([['    if (x !== undefined && !valueAt(V, props, e, i, x)) return false\n  }\n  return true', '  }\n  return true']])])
mutations.push(['a non-enumerable property skipped where own names are read, many declared', mutantMore([['    if (x !== undefined && !valueAt(V, props, e, j, x)) return false\n  }\n  return true', '  }\n  return true']])])
mutations.push(['a dynamic scope entry not popped', mutantMore([['return b === undefined || V.scope.includes(b) ? V : extend(V, b)', 'return b === undefined || V.scope.includes(b) ? V : (V.scope.push(b), V)']])])
// The form that records what subschemas evaluated (unevaluated*).
mutations.push(['annotations of a failed anyOf branch counted', mutantMore([['if (anyF[i](d)) n++\n          else { np = p1; nc = c1; nk = k1 }', 'if (anyF[i](d)) n++']])])
mutations.push(['names a pattern matched in a failed anyOf branch counted', mutantMore([['if (anyF[i](d)) n++\n          else { np = p1; nc = c1; nk = k1 }', 'if (anyF[i](d)) n++\n          else { np = p1; nc = c1 }']])])
mutations.push(['annotations of a failed oneOf branch counted', mutantMore([['if (oneF[i](d)) { if (++n > 1) return false } else { np = p1; nc = c1; nk = k1 }', 'if (oneF[i](d)) { if (++n > 1) return false }']])])
mutations.push(['annotations of a passing if dropped', mutantMore([['if (ifF(d)) { if (thenF', 'if (ifF(d)) { np = p1; nc = c1; nk = k1; if (thenF']])])
mutations.push(['an index contains did not match counted as evaluated', mutantMore([['if (ctf(d[i])) { c++; EC[nc++] = i }', '{ if (ctf(d[i])) c++; EC[nc++] = i }']])])
mutations.push(['a property that can pass taken as one that never does', mutant([['  if (s === false) return true\n', '  if (s === false || s === true || (isMap(s) && s.type === \'integer\')) return true\n']])])
mutations.push(['array items checked in place without their bounds', mutant([['if (!(Number.isInteger(x) && x >= a && x <= b)) return false', 'if (!Number.isInteger(x)) return false']])])
mutations.push(['a failing inherited key taken as own', mutant([['has(o, k) ? false : exactObj(', 'false && exactObj(']])])
for (const [name, make] of mutations) {
  const m = run(make, false)
  assert.ok(m.differ > 0, `mutation "${name}" went unnoticed`)
  console.log(`  mutation ${name}: caught on ${m.differ} documents`)
}

// Patterns matched without a RegExp (sequence() in the core) against the
// platform RegExp with the u flag: a million strings per pattern, built from
// a valid sample changed at random positions, with ASCII, other BMP
// characters, lone surrogates of both halves and surrogate pairs. Each
// pattern must be one the core recognises, or this compares RegExp with
// itself. A matcher that accepts a longer string must be caught.
const { _sequence } = require('../lib/core/verdict.js')
const FAMILIES = [
  ['^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', '01890a5d-ac96-774b-bcce-b302099a8057'],
  ['^\\d{4}-\\d{2}-\\d{2}$', '2026-10-31'],
  ['^[0-9a-f]{16}$', '0123456789abcdef'],
  ['^#[0-9a-f]{6}$', '#00ff00'],
  ['^[A-Z]{3}-\\d{4}$', 'ABC-1234'],
  ['^[a-z0-9-]{1,16}$', 'a-1'],
  ['^[A-Za-z0-9._-]{2,12}$', 'A.b_c'],
  ['^\\w{2,5}$', 'ab_9'],
  ['^[a-c]?$', 'b'],
  ['^[\\]\\-a]{0,8}$', ']-a'],
]
const PALETTE = ['a', 'f', 'z', 'A', 'Z', '0', '9', '-', '_', '.', '#', ']', ' ', '\n', 'é', '\u0130', '\u212a', '\ud83d', '\ude00', '\ud83d\ude00', '\u0000', 'g', 'G', '/']
let seed = 7
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n }
function fuzz (test, src, sample, count) {
  const re = new RegExp(src, 'u')
  let differ = 0, matched = 0
  for (let t = 0; t < count; t++) {
    let x = sample
    const edits = rnd(4)
    for (let e = 0; e < edits; e++) {
      const at = rnd(x.length + 1), r = rnd(3), ch = PALETTE[rnd(PALETTE.length)]
      x = r === 0 ? x.slice(0, at) + ch + x.slice(at + 1) : r === 1 ? x.slice(0, at) + ch + x.slice(at) : x.slice(0, at) + x.slice(at + 1)
    }
    const want = re.test(x)
    if (test(x) !== want) differ++
    if (want) matched++
  }
  // Both answers must be common, or the strings do not test the matcher.
  assert.ok(matched > count / 50 && matched < count - count / 50, `${src}: ${matched} of ${count} strings match`)
  return differ
}
let fuzzed = 0
for (const [src, sample] of FAMILIES) {
  const m = _sequence(src)
  assert.ok(m !== null, 'not recognised: ' + src)
  assert.strictEqual(createVerdict({ type: 'string', pattern: src }, {})(sample), true, src)
  const d = fuzz(m.test, src, sample, 1e6)
  assert.strictEqual(d, 0, `${src}: ${d} strings answered unlike the RegExp`)
  fuzzed += 1e6
}
{
  const broken = mutant([['if (x.length !== L) return false', 'if (x.length < L) return false']])
  let caught = 0
  for (const [src, sample] of FAMILIES) {
    const f = broken({ type: 'string', pattern: src }, {})
    caught += fuzz((x) => f(x), src, sample, 20000)
  }
  assert.ok(caught > 0, 'mutation "sequence matcher accepts longer strings" went unnoticed')
  console.log(`  mutation sequence matcher accepts longer strings: caught on ${caught} strings`)
}

console.log(`test_core_verdict: ok, ${taken} schemas taken, ${declined} declined, ${r.shaped} with an enum or required that is not a list thrown, ${r.docs} documents as the interpreter's walk; ${fuzzed} strings on ${FAMILIES.length} patterns matched without a RegExp; ${uncaptured} schemas no document of which made the Validator build its interpreter`)
