// The module writer's verdict moves code out of large functions (lib/ir/emit.mjs):
// an object that lists many names visits the object's own names and looks
// each up in a table of functions, a large property body becomes a function
// of its value, and an enum of 64 or more strings is a Set. Each move must
// keep the answer, so these schemas take every one of those paths and each
// document's verdict is compared with the current engine's.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import * as K from '../lib/kernels/index.mjs'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')

const load = (schema) => {
  const src = specialize(schema, { assertFormat: false, verdict: true })
  return { src, m: new Function('K', functionBody(src))(K) }
}

// Small entries, entries that are one call ($ref), entries of a few calls
// (anyOf), a large nested object and a long enum, side by side.
const words = [...Array(100)].map((_, i) => 'w' + i)
const nested = { type: 'object', properties: {} }
for (let i = 0; i < 60; i++) nested.properties['n' + i] = { type: 'integer', minimum: i, maximum: 1000 }
const props = {}
for (let i = 0; i < 20; i++) props['s' + i] = { type: 'string', maxLength: 8 }
for (let i = 0; i < 20; i++) props['r' + i] = { $ref: '#/$defs/pos' }
for (let i = 0; i < 6; i++) props['a' + i] = { anyOf: [{ type: 'string', minLength: 2 }, { type: 'number', minimum: 0 }] }
props.big = nested
props.word = { enum: words }
props.toString = { type: 'boolean' }
props.__proto__ = { type: 'number' }
const mixed = { type: 'object', properties: props, $defs: { pos: { type: 'integer', minimum: 1 } } }

// Hundreds of short entries of a few calls each: together past the budget,
// so the small ones move too.
const many = { type: 'object', properties: {} }
for (let i = 0; i < 300; i++) many.properties['p' + i] = { anyOf: [{ type: 'string' }, { type: 'integer', minimum: i }] }

const good = (schema) => {
  const d = {}
  for (const [k, p] of Object.entries(schema.properties)) {
    if (k === '__proto__') continue
    if (p === nested) d[k] = Object.fromEntries(Object.keys(nested.properties).map((n, i) => [n, i + 1]))
    else if (p.enum) d[k] = 'w77'
    else if (p.$ref) d[k] = 3
    else if (p.anyOf) d[k] = 'ok'
    else if (p.type === 'boolean') d[k] = true
    else d[k] = 'x'
  }
  return d
}
// One wrong value per name, and one per nested name.
const bad = (schema) => {
  const out = []
  for (const k of Object.keys(schema.properties)) {
    if (k === '__proto__') continue
    for (const v of [null, -5, 'a', [], {}, 'w100', 'longer than eight']) out.push({ ...good(schema), [k]: v })
  }
  for (const n of Object.keys(nested.properties)) out.push({ ...good(mixed), big: { ...good(mixed).big, [n]: -1 } })
  return out
}
const nonEnumerable = (schema) => { const d = good(schema); Object.defineProperty(d, 's1', { value: 5, enumerable: false }); return d }
const edges = (schema) => [
  {},
  { ...good(schema), unlisted: 1 },
  Object.assign(Object.create(null), good(schema)),
  Object.assign(Object.create({ s0: 5, r0: 0 }), good(schema)),
  { ...good(schema), s0: undefined, r1: undefined },
  nonEnumerable(schema),
  JSON.parse('{"__proto__": "not a number", "s0": "x"}'),
  JSON.parse('{"__proto__": 1, "s0": "x"}'),
  { toString: 'no' },
  { [Symbol('s0')]: 5 },
  [],
  'text',
]

let checked = 0
for (const [name, schema, expect] of [['mixed', mixed, ['new Map(', 'new Set(', 'function L']], ['many', many, ['new Map(', 'function L']]]) {
  const { src, m } = load(schema)
  for (const s of expect) assert.ok(src.includes(s), `${name}: the module has no ${s}, so the path under test did not run`)
  const ata = new Validator(schema)
  const docs = [good(schema), ...bad(schema), ...edges(schema)]
  let rejected = 0
  for (const d of docs) {
    const want = ata.isValidObject(d)
    if (!want) rejected++
    assert.strictEqual(m.isValid(d), want, `${name}: isValid on ${JSON.stringify(d)?.slice(0, 120)}`)
    assert.strictEqual(m.validate(d).valid, want, `${name}: validate() on ${JSON.stringify(d)?.slice(0, 120)}`)
    checked++
  }
  assert.ok(rejected > docs.length / 2 && rejected < docs.length, `${name}: documents not mixed enough, ${rejected} of ${docs.length} rejected`)
}
console.log(`ok: the module writer's tables, moved functions and enum sets answer as the current engine on ${checked} documents`)
