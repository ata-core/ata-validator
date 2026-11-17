'use strict'

// removeAdditional strips a closed object wherever validation applies its
// schema to a value without choosing between schemas (issue #116): array
// elements under `items` and `prefixItems`, a `$ref` into the same document
// (recursive ones included), `allOf` members, the values of
// `patternProperties` and `additionalProperties`, and `dependentSchemas`.
// The pass used to follow `properties` only, so the same extra key was
// removed at the top and left in an array element, and the document was
// rejected. `anyOf`, `oneOf`, `not` and `if` are not followed: removing for a
// branch that does not apply would delete data the one that does accepts.
// Every path gives the same document and verdict: generated code (cold and
// hot), the interpreted engine, the closure tree, lite, ata-validator/ir, and
// a module from bundleStandalone.

const assert = require('assert')
const path = require('path')
const { Validator } = require('..')
const lite = require('../lite')
const { bundleStandalone } = require('../build.js')

const item = { type: 'object', properties: { id: { type: 'integer' } }, additionalProperties: false }
const cases = [
  ['items', { type: 'object', properties: { list: { type: 'array', items: item } } }, { list: [{ id: 1, extra: 1 }, { id: 2 }] }, { list: [{ id: 1 }, { id: 2 }] }],
  ['root array', { type: 'array', items: item }, [{ id: 1, extra: 1 }], [{ id: 1 }]],
  ['prefixItems', { type: 'array', prefixItems: [item], items: { type: 'object' } }, [{ id: 1, extra: 1 }, { keep: 1 }], [{ id: 1 }, { keep: 1 }]],
  ['$ref', { type: 'object', $defs: { item }, properties: { one: { $ref: '#/$defs/item' } } }, { one: { id: 1, extra: 1 } }, { one: { id: 1 } }],
  ['$ref in items', { type: 'object', $defs: { item }, properties: { list: { type: 'array', items: { $ref: '#/$defs/item' } } } }, { list: [{ id: 1, extra: 1 }] }, { list: [{ id: 1 }] }],
  ['draft-07 definitions', { $schema: 'http://json-schema.org/draft-07/schema#', definitions: { item }, type: 'object', properties: { list: { type: 'array', items: { $ref: '#/definitions/item' } } } }, { list: [{ id: 1, extra: 1 }] }, { list: [{ id: 1 }] }],
  ['allOf', { allOf: [item] }, { id: 1, extra: 1 }, { id: 1 }],
  ['recursive', { $defs: { node: { type: 'object', properties: { v: {}, kids: { type: 'array', items: { $ref: '#/$defs/node' } } }, additionalProperties: false } }, $ref: '#/$defs/node' }, { v: 1, x: 1, kids: [{ v: 2, y: 2, kids: [{ v: 3, z: 3 }] }] }, { v: 1, kids: [{ v: 2, kids: [{ v: 3 }] }] }],
  ['patternProperties only', { type: 'object', patternProperties: { '^x-': {} }, additionalProperties: false }, { 'x-a': 1, extra: 2 }, { 'x-a': 1 }],
  ['under a pattern', { type: 'object', patternProperties: { '^x-': item } }, { 'x-a': { id: 1, extra: 2 } }, { 'x-a': { id: 1 } }],
  ['additionalProperties map', { type: 'object', additionalProperties: item }, { a: { id: 1, extra: 2 } }, { a: { id: 1 } }],
  ['dependentSchemas', { type: 'object', properties: { a: {} }, dependentSchemas: { a: { properties: { b: item } } } }, { a: 1, b: { id: 1, extra: 1 } }, { a: 1, b: { id: 1 } }],
  ['anyOf is not followed', { anyOf: [item, { type: 'object' }] }, { id: 1, extra: 1 }, { id: 1, extra: 1 }],
  ['oneOf is not followed', { oneOf: [item, { required: ['extra'] }] }, { id: 1, extra: 1 }, { id: 1, extra: 1 }],
]

const paths = {
  'generated code': (s) => { const v = new Validator(s, { removeAdditional: true }); return (d) => v.validate(d) },
  'generated code, hot': (s, d0) => { const v = new Validator(s, { removeAdditional: true }); for (let i = 0; i < 80; i++) v.validate(structuredClone(d0)); return (d) => v.validate(d) },
  'interpreted engine': (s) => { const v = new Validator(s, { removeAdditional: true, engine: 'interpreter' }); return (d) => v.validate(d) },
  'closure tree': (s, d0) => { const v = new Validator(s, { removeAdditional: true, engine: 'interpreter' }); for (let i = 0; i < 1100; i++) v.isValidObject(structuredClone(d0)); return (d) => v.validate(d) },
  'isValidObject': (s) => { const v = new Validator(s, { removeAdditional: true }); return (d) => ({ valid: v.isValidObject(d) }) },
  'lite': (s) => { const v = new lite.Validator(s, { removeAdditional: true }); return (d) => v.validate(d) },
  'bundleStandalone': (s) => { const m = { exports: {} }; new Function('module', 'require', bundleStandalone([s], { removeAdditional: true }))(m, require); return (d) => m.exports[0](d) },
}

// A module carries the generated pass, which follows properties, array
// elements, references and allOf without recursion and without patterns. For
// the rest bundleStandalone refuses, rather than write a module that keeps
// the keys.
const MODULE_REFUSES = new Set(['recursive', 'patternProperties only', 'under a pattern', 'additionalProperties map', 'dependentSchemas'])

let checked = 0
for (const [name, schema, input, want] of cases) {
  for (const [p, make] of Object.entries(paths)) {
    if (p === 'bundleStandalone' && MODULE_REFUSES.has(name)) {
      assert.throws(() => make(schema, input), /removeAdditional cannot be compiled into a standalone module/, `${name}: bundleStandalone refuses`)
      checked++
      continue
    }
    const run = make(schema, input)
    const d = structuredClone(input)
    const r = run(d)
    assert.strictEqual(r.valid, true, `${name} / ${p}: valid`)
    assert.deepStrictEqual(d, want, `${name} / ${p}: document afterwards`)
    checked++
  }
}

// A key a sibling allOf member declares is removed by the closed member, as
// validation reads a closed member against its own properties.
{
  const s = { allOf: [item, { properties: { name: { type: 'string' } } }] }
  const d = { id: 1, name: 'a' }
  assert.strictEqual(new Validator(s, { removeAdditional: true }).validate(d).valid, true)
  assert.deepStrictEqual(d, { id: 1 })
}

// The fused verdict strips every closed object it reaches or none: a closed
// object in items below a node that also has properties was left out, and
// the verdict rejected the key the pass removes.
{
  const A = { type: 'object', properties: { id: {} }, additionalProperties: false }
  const s = { type: 'array', items: { type: 'array', properties: { unused: A }, items: { ...A } } }
  for (const o of [{}, { engine: 'interpreter' }]) {
    const d = [[{ id: 1, extra: 1 }]]
    assert.strictEqual(new Validator(s, { removeAdditional: true, ...o }).validate(d).valid, true)
    assert.deepStrictEqual(d, [[{ id: 1 }]])
  }
}

// A schema reached on many paths does not grow the generated pass without
// bound: an allOf chain repeating a reference at each level declines it, and
// the closure pass takes the schema.
{
  const defs = { n0: item }
  for (let i = 1; i < 40; i++) defs['n' + i] = { allOf: [{ $ref: '#/$defs/n' + (i - 1) }, { $ref: '#/$defs/n' + (i - 1) }] }
  const t = Date.now()
  const src = require('../lib/codegen-engine.js').preprocessSource({ $defs: defs, $ref: '#/$defs/n39' }, { removeAdditional: true })
  assert.strictEqual(src, null, 'the generated pass declines')
  assert.ok(Date.now() - t < 2000, 'and decides quickly')
  const d = { id: 1, extra: 1 }
  require('../lib/remove-additional.js').buildRemover({ $defs: defs, $ref: '#/$defs/n39' }, (x) => new RegExp(x, 'u'))(d)
  assert.deepStrictEqual(d, { id: 1 }, 'the closure pass applies each shared schema once per value')
}

// Data deeper than the schema bounds terminates.
{
  const s = { $defs: { n: { type: 'object', properties: { c: { $ref: '#/$defs/n' } }, additionalProperties: false } }, $ref: '#/$defs/n' }
  let d = {}; for (let i = 0; i < 600; i++) d = { c: d, x: 1 }
  new Validator(s, { removeAdditional: true, engine: 'interpreter' }).validate(d)
}

;(async () => {
  const ir = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'lib', 'ir', 'index.mjs')).href)
  for (const [name, schema, input, want] of cases) {
    if (schema.$schema) continue
    const d = structuredClone(input)
    const r = ir.compileClosures(schema, { removeAdditional: true }).validate(d)
    assert.strictEqual(r.valid, true, `${name} / ir: valid`)
    assert.deepStrictEqual(d, want, `${name} / ir: document afterwards`)
    checked++
  }
  console.log(`ok: removeAdditional reaches items, $ref, allOf and the rest on every path (${checked} checks)`)
})().catch((e) => { console.error(e); process.exit(1) })
