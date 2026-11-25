'use strict'

// lib/validator-small.js asks five questions of a schema before it builds
// anything: whether it has errorMessage, default or format, whether it
// references a json-schema.org document, and whether it has $id or an anchor.
// Without the verdict core it asks them of the schema's JSON text; with it
// (lib/core/feature.js), of a text the core writes from its scan, or from an
// exact walk where the scan cannot stand for the text. This holds the exact
// walk and the scan to the text, and the answers the Validator gets to the
// text's, on every schema of the official
// suite (as given and as the Validator normalises it), on edge cases of the
// text, and on SchemaStore when ATA_SCHEMASTORE names a checkout.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { facts, scan } = require('../lib/core/verdict.js')
const core = require('../lib/core/feature.js')
// The questions as _build asks them of a text (the schema's, or the core's).
const NOT_FLAT = /"\$(?:id|anchor|dynamicAnchor|recursiveAnchor)"/
// The Validator's own expression, read from its source (it is not exported:
// an export would be bytes on every page).
const META_REF = new RegExp(/^const META_REF = \/(.+)\/;$/m.exec(fs.readFileSync(path.join(__dirname, '../lib/validator-small.js'), 'utf8'))[1])
// A fact as the question's answer: the scan keeps the references that hold
// `json-schema.org/` as text, for the Validator's expression to judge.
const fact = (f, k) => k === 'metaRef' ? META_REF.test(f[k]) : f[k]
const asked = (t) => ({ errorMessage: t.includes('"errorMessage"'), default: t.includes('"default"'), format: t.includes('"format"'), metaRef: t.includes('json-schema.org/') && META_REF.test(t), notFlat: NOT_FLAT.test(t) })
// The same questions asked of the schema's own JSON text.
const textFacts = (schema) => asked(JSON.stringify(schema) || '')
const FIELDS = ['errorMessage', 'default', 'format', 'metaRef', 'notFlat']
const im = require('../lib/interpreter.js')

let n = 0, fellBack = 0, scanned = 0
function same (schema, label) {
  const want = textFacts(schema)
  const q = asked(core(schema))
  for (const k of FIELDS) assert.strictEqual(q[k], want[k], label + ': ' + k + ' as the Validator asks it')
  const st = scan(schema, true)
  if (st.facts !== null) { scanned++; for (const k of FIELDS) assert.strictEqual(fact(st.facts, k), want[k], label + ': ' + k + ' in the scan') }
  const f = facts(schema)
  if (f === null) { fellBack++; return }
  n++
  for (const k of FIELDS) assert.strictEqual(fact(f, k), want[k], label + ': ' + k)
}

// Schemas as given, and as the Validator hands them on (normalised).
const real = im.createInterpreter
let cap = null
im.createInterpreter = (schema, args) => { cap = schema; return real(schema, args) }
const { Validator } = require('..')
const SUITE = path.join(__dirname, 'suite/tests')
for (const dialect of fs.readdirSync(SUITE)) {
  for (const sub of ['', 'optional', 'optional/format']) {
    const dir = path.join(SUITE, dialect, sub)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        const label = `${dialect}/${sub}/${f}: ${g.description}`
        same(g.schema, label)
        cap = null
        try { const v = new Validator(g.schema, { engine: 'interpreter', useDefaults: false }); v.isValidObject(null); for (const t of g.tests) { if (cap) break; v.validate(t.data) } } catch {}
        if (cap !== null) same(cap, label + ' (normalised)')
      }
    }
  }
}

// The text's edges: a token that a string only borders, keys and values that
// JSON.stringify leaves out or changes.
const edges = [
  { a: 'x"default' }, { a: 'default"y' }, { 'k"default': 1 }, { a: 'xdefaulty' }, { default: undefined }, { default: () => 1 },
  { a: ['default'] }, { a: [undefined, 'format'] }, { 'x"$ref': 'https://json-schema.org/draft/2020-12/schema' },
  { $ref: 'x"https://json-schema.org/' }, { $ref: 'https://json-schema.org/' }, { $dynamicRef: 'json-schema.org/' },
  { a: { $recursiveRef: 'http://json-schema.org/schema' } }, { a: '$id' }, { a: 'x"$anchor' }, { $anchor: undefined },
  { errorMessage: null }, { a: 'errorMessage"' }, { ' default': 1 }, { a: 'de\nfault' }, { a: '"default"' },
]
for (const e of edges) same(e, JSON.stringify(e))
// Every word and reference keyword between characters JSON.stringify escapes
// or that border a token, as a key, a value and a keyword's value.
const WORDS = ['errorMessage', 'default', 'format', '$id', '$anchor', '$dynamicAnchor', '$recursiveAnchor', '$ref', '$dynamicRef', '$recursiveRef']
const SIDES = ['', '"', '\\', '\\"', '"\\', 'x', 'x"', '"x', ' ', '\n', '\u2028', '\ud800', ':', '":"', 'a"b']
let generated = 0
for (const w of WORDS) {
  for (const a of SIDES) {
    for (const b of SIDES) {
      const t = a + w + b
      for (const e of [{ description: t }, { [t]: 1 }, { [t]: 'https://json-schema.org/draft/2020-12/schema' }, { [t]: t + 'json-schema.org/' }, { enum: [t] }, { properties: { [t]: {} } }, { $ref: t }, { title: [t, { [t]: t }] }]) { same(e, 'generated: ' + JSON.stringify(e)); generated++ }
    }
  }
}
// What the core's scan skips: type names it knows, required names that are
// declared properties, keyword names that hold no word. And values the scan
// cannot read as the text does.
class Node { constructor () { this.type = 'string'; this.description = 'default' } }
const hidden = Object.defineProperty({ type: 'object', required: ['format'] }, 'properties', { value: { format: {} }, enumerable: false })
const scanEdges = [
  { required: ['format'] }, { properties: { a: {} }, required: ['a', 'default'] }, { properties: { format: {} }, required: ['format'] },
  { required: ['errorMessage'], properties: { errorMessage: true } }, { type: 'default' }, { type: ['string', 'format'] },
  { properties: { x: { type: 'string', description: 'x"format"' } } }, hidden, { properties: { a: new Node() } },
  { description: new String('format') }, { properties: { a: { enum: [new String('default')] } } }, Object.assign(Object.create(null), { type: 'string', title: 'default' }),
  { allOf: [{ $id: 'x' }] }, { $defs: { a: { $anchor: 'a' } } }, { properties: { a: { $dynamicAnchor: 'a' } } }, { items: [{ format: 'date' }] },
  { properties: { 'a"format': {} } },
  { properties: Object.assign(Object.create({ toJSON () { return { default: 1 } } }), { a: {} }) }, { allOf: Object.assign([{}], { toJSON: () => ['format'] }) },
  { required: Object.assign(['a'], { toJSON: () => ['default'] }), properties: { a: {} } }, { type: Object.assign(['string'], { toJSON: () => 'errorMessage' }) },
  { patternProperties: Object.defineProperty({ x: {} }, 'toJSON', { value: () => ({ $id: 'x' }) }) }, { properties: { a: Object.defineProperty({}, 'toJSON', { value: () => ({ format: 1 }) }) } }, { propertyDependencies: { default: { a: { type: 'string' } } } }, { patternProperties: { '^format$': {} } },
]
for (const e of scanEdges) { let label; try { label = JSON.stringify(e) } catch { label = String(e) } same(e, 'scan: ' + label) }
// toJSON and bigint: the walk hands the question back to the text.
assert.strictEqual(facts({ a: { toJSON: () => 'default' } }), null)
assert.strictEqual(facts({ a: 1n }), null)

let ss = 0
const root = process.env.ATA_SCHEMASTORE
if (root) {
  const dir = path.join(root, 'src/schemas/json')
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let schema; try { schema = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
    same(schema, 'schemastore/' + f)
    cap = null
    try { const v = new Validator(schema, { engine: 'interpreter', useDefaults: false }); v.isValidObject(null); v.validate(null); v.validate({}) } catch {}
    if (cap !== null) same(cap, 'schemastore/' + f + ' (normalised)')
    ss++
  }
}

assert.ok(n > 5000, `${n} schemas compared`)
assert.ok(generated > 10000, `${generated} generated schemas`)
console.log(`test_validator_small_facts: ok, ${n} schemas answered the same both ways${root ? `, ${ss} SchemaStore files among them` : ''}; ${fellBack} left to the text; the scan answered for ${scanned}`)
