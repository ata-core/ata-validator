'use strict'

// v1 writes `$dynamicRef` as the bare name of a `$dynamicAnchor`
// (`"$dynamicRef": "items"`), where 2020-12 writes a URI reference with the
// name as its fragment (`"#items"`). The official suite switched its v1 cases
// to the bare form at e2a68a1. Read as a URI, "items" names a document that
// is not there, and every engine rejected documents the schema accepts.
//
// Checked here on every path a v1 schema with $dynamicRef reaches: validate(),
// isValidObject(), validateJSON(), the buffer APIs, ata-validator/ir's
// closures, and the two copies of the rule (lib/interpreter-core.js and
// lib/ir/front.mjs).

const assert = require('node:assert')
const { Validator } = require('..')
const interp = require('../lib/interpreter-core')

let checks = 0

const V1 = 'https://json-schema.org/v1'
const cases = [
  // The same resource: behaves like a $ref to the anchor.
  [{ $schema: V1, type: 'array', items: { $dynamicRef: 'items' }, $defs: { foo: { $dynamicAnchor: 'items', type: 'string' } } },
    [[['a', 'b'], true], [['a', 1], false]]],
  // A plain name need not be ASCII (XML NCName).
  [{ $schema: V1, type: 'array', items: { $dynamicRef: 'élément' }, $defs: { foo: { $dynamicAnchor: 'élément', type: 'string' } } },
    [[['a', 'b'], true], [['a', 1], false]]],
  // The outermost anchor on the dynamic scope wins.
  [{ $schema: V1, $id: 'https://example.com/root', $ref: 'list', $defs: {
    foo: { $dynamicAnchor: 'items', type: 'string' },
    list: { $id: 'list', type: 'array', items: { $dynamicRef: 'items' }, $defs: { items: { $dynamicAnchor: 'items' } } },
  } }, [[['a', 'b'], true], [['a', 1], false]]],
]


for (const [schema, docs] of cases) {
  const v = new Validator(schema)
  const interpOnly = new Validator(schema, { engine: 'interpreter' })
  for (const [doc, want] of docs) {
    const text = JSON.stringify(doc)
    assert.strictEqual(v.validate(doc).valid, want, `validate ${text}`)
    assert.strictEqual(v.isValidObject(doc), want, `isValidObject ${text}`)
    assert.strictEqual(v.validateJSON(text).valid, want, `validateJSON ${text}`)
    assert.strictEqual(v.isValid(Buffer.from(text)), want, `isValid(buffer) ${text}`)
    assert.strictEqual(v.isValid(Buffer.from(text + ' '.repeat(9000))), want, `isValid(large buffer) ${text}`)
    assert.strictEqual(interpOnly.validate(doc).valid, want, `interpreter ${text}`)
    checks += 6
  }
}

;(async () => {
  const front = await import('../lib/ir/front.mjs')
  for (const ref of ['items', 'a', '_x', 'a-b.c_d', '#items', 'other#items', 'https://example.com/s', '#/$defs/a', '', '1a', 'a b', 'a/b', 'a:b', 'élément']) {
    for (const v1 of [true, false]) {
      assert.strictEqual(interp._dynamicRefUri(ref, v1), front.dynamicRefUri(ref, v1), `the two copies differ on ${JSON.stringify(ref)} (v1 ${v1})`)
      checks++
    }
  }
  assert.strictEqual(front.dynamicRefUri('items', true), '#items')
  assert.strictEqual(front.dynamicRefUri('items', false), 'items')
  assert.strictEqual(front.dynamicRefUri('other#items', true), 'other#items')
  assert.strictEqual(front.dynamicRefUri('élément', true), '#élément')
  assert.strictEqual(front.dynamicRefUri('', true), '')
  const { compileClosures } = await import('../lib/ir/index.mjs')
  for (const [schema, docs] of cases) {
    const c = compileClosures(schema, {})
    for (const [doc, want] of docs) {
      assert.strictEqual(c.validate(doc).valid, want, `ir closures ${JSON.stringify(doc)}`)
      checks++
    }
  }
  console.log(`ok: v1 $dynamicRef as a bare anchor name, ${checks} checks`)
})().catch((e) => { console.error(e); process.exit(1) })
