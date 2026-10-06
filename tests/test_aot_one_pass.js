'use strict'

// A standalone module reports errors with the runtime's one-pass function
// (onePassCore in lib/aot-impl.js): the program compileToJSCombined builds
// for validate(), written out with its closure values as declarations. Held
// to the runtime's validate() on the same documents: the same errors (code,
// keyword, paths, params, message, docUrl), in the runtime's order where the
// runtime's list is in schema order, and the same verdicts through validate(),
// isValid() and validateJSON(). The older collector stays reachable with
// { noOnePass: true } and answers the same set of errors.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

const schemas = [
  { type: 'object', properties: { a: { type: 'string', format: 'email' }, b: { oneOf: [{ type: 'integer' }, { type: 'boolean' }] }, c: { enum: ['x', 'y'] }, d: { type: 'array', items: { type: 'string', pattern: '^[a-z]+$' }, uniqueItems: true }, e: { $ref: '#/$defs/n' } }, required: ['a'], additionalProperties: false, $defs: { n: { type: 'object', properties: { k: { type: 'integer', minimum: 3 } }, required: ['k'] } } },
  { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { tags: { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'integer' } }, who: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'object', required: ['id'], properties: { id: { type: 'integer' } }, additionalProperties: false }] } }, dependentRequired: { who: ['tags'] }, unevaluatedProperties: false },
  { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#' } } }, required: ['name'], additionalProperties: false },
  { type: 'object', patternProperties: { '^x-': { type: 'string', maxLength: 3 } }, properties: { n: { type: 'number', multipleOf: 0.5, exclusiveMaximum: 10 }, s: { type: 'string', const: 'fixed' } }, additionalProperties: { type: 'boolean' } },
]
const docs = [
  {}, null, [], 'str', 7,
  { a: 'x@y.z' }, { a: 'nope', b: 'q', c: 'z', d: ['A', 'b', 'b'], e: { k: 1 }, f: 1 }, { a: 1 }, { a: 'x@y.z', e: {} }, { a: 'x@y.z', b: true, d: ['a'] },
  { tags: ['t', 1], who: 'ab' }, { tags: [1], who: { id: 'x', extra: 1 }, other: true }, { who: 'a' },
  { name: 'r', children: [{ name: 'c', children: [{ name: 2 }] }, { nope: 1 }] },
  { 'x-a': 'toolong', n: 10.25, s: 'other', z: 'notbool' }, { 'x-a': 'ok', n: 2.5, s: 'fixed', z: true },
]
const shape = (e) => ({ code: e.code, keyword: e.keyword, instancePath: e.instancePath, schemaPath: e.schemaPath, params: e.params, message: e.message, docUrl: e.docUrl, branch: (e.branchErrors || []).map((b) => [b.keyword, b.instancePath, b.schemaPath]) })
const asSet = (errs) => errs.map((e) => JSON.stringify(shape(e))).sort()
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-one-pass-'))
let compared = 0, rejected = 0, ordered = 0
schemas.forEach((schema, i) => {
  const src = toStandaloneModule(schema, { format: 'cjs', positions: true, onePass: true })
  assert.ok(src, `schema ${i} compiles`)
  assert.ok(/const _vC = \(function/.test(src), `schema ${i} carries the one-pass function`)
  assert.ok(!/\brequire\(/.test(src), 'imports nothing')
  const srcOld = toStandaloneModule(schema, { format: 'cjs', onePass: false })
  assert.ok(!/const _vC = \(function/.test(srcOld), 'noOnePass keeps the older collector')
  const f = path.join(dir, `m${i}.cjs`), fo = path.join(dir, `o${i}.cjs`)
  fs.writeFileSync(f, src); fs.writeFileSync(fo, srcOld)
  const mod = require(f), old = require(fo)
  const rt = new Validator(schema, { useDefaults: false })
  for (let r = 0; r < 60; r++) for (const d of docs) { mod.validate(d); rt.validate(d).errors }
  for (const d of docs) {
    const a = mod.validate(d), b = rt.validate(d)
    assert.strictEqual(a.valid, b.valid, `schema ${i} verdict on ${JSON.stringify(d)}`)
    assert.strictEqual(mod.isValid(d), b.valid)
    assert.strictEqual(mod.validateJSON(JSON.stringify(d)).valid, b.valid)
    if (b.valid) { compared++; continue }
    rejected++
    // the runtime enriches on read; compare the fields a module reports
    const be = b.errors.map((e) => ({ ...e, code: e.code, docUrl: e.docUrl }))
    assert.deepStrictEqual(asSet(a.errors), asSet(be), `schema ${i} errors on ${JSON.stringify(d)}`)
    // the older collector left docUrl off a collapsed oneOf/anyOf error
    const noUrl = (set) => set.map((t) => t.replace(/,"docUrl":"[^"]*"/, ''))
    assert.deepStrictEqual(noUrl(asSet(old.validate(d).errors)), noUrl(asSet(be)), `schema ${i} older collector agrees on ${JSON.stringify(d)}`)
    if (a.errors.every((e, k) => e.schemaPath === be[k].schemaPath && e.instancePath === be[k].instancePath)) ordered++
    for (const e of mod.validateJSON(JSON.stringify(d)).errors) assert.ok(e.dataFrame && typeof e.dataFrame.line === 'number', 'validateJSON frames every error')
    compared++
  }
})
assert.ok(rejected >= 12)
// Every rejected list came out in the runtime's order here.
assert.strictEqual(ordered, rejected, `${ordered} of ${rejected} rejected lists in the runtime's order`)
// A custom format has no source form: the module keeps the older collector and still answers.
{
  const v = new Validator({ type: 'string', format: 'odd' }, { formats: { odd: (s) => s.length % 2 === 1 } })
  const src = toStandaloneModule(v, { format: 'cjs' })
  assert.ok(src && !/const _vC = \(function/.test(src), 'custom format: older collector')
}
fs.rmSync(dir, { recursive: true, force: true })
console.log(`ok: standalone modules report with the one-pass function, ${compared} documents over ${schemas.length} schemas agree with the runtime, ${rejected} rejected lists in its order`)
