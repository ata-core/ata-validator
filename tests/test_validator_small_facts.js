'use strict'

// lib/validator-small.js asks five questions of a schema before it builds
// anything: whether it has errorMessage, default or format, whether it
// references a json-schema.org document, and whether it has $id or an anchor.
// It asked them of the schema's JSON text; it now asks them by walking the
// schema. This holds the two to the same answers on every schema of the
// official suite (as given and as the Validator normalises it), on edge cases
// of the text, and on SchemaStore when ATA_SCHEMASTORE names a checkout.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { facts, textFacts } = require('../lib/validator-small.js')._facts
const im = require('../lib/interpreter.js')

let n = 0, fellBack = 0
function same (schema, label) {
  const want = textFacts(schema)
  const f = facts(schema)
  if (f === null) { fellBack++; return }
  n++
  const got = { errorMessage: f.errorMessage, default: f.default, format: f.format, metaRef: f.metaRef, notFlat: f.notFlat }
  assert.deepStrictEqual(got, want, label)
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
console.log(`test_validator_small_facts: ok, ${n} schemas answered the same both ways${root ? `, ${ss} SchemaStore files among them` : ''}; ${fellBack} left to the text`)
