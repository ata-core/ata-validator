'use strict'

// bundleStandalone runs the runtime's passes over the data for the options it
// was given: coerceTypes and removeAdditional before the check, and the
// defaults pass with `useDefaults: true`. Each validator of a schema with a
// default also carries it as `applyDefaults`. A bundle used to leave
// coerceTypes and removeAdditional out without a word and reject what the
// runtime accepts. Where the generated pass cannot carry what the runtime
// would do, the bundle refuses. Every case is checked against
// `new Validator(schema, options)`: the verdict, the data afterwards, and the
// errors in order (`order: true`).

const assert = require('node:assert')
const { Validator } = require('..')
const { bundleStandalone } = require('../build.js')

const load = (src) => { const m = { exports: {} }; new Function('module', 'require', src)(m, require); return m.exports }

const schemas = [
  { $id: 'signup', type: 'object', required: ['age', 'name'], additionalProperties: false, properties: { age: { type: 'integer', minimum: 13 }, name: { type: 'string', default: 'anon' }, admin: { type: 'boolean', default: false }, tags: { type: 'array', items: { type: 'string' } } } },
  { $id: 'order', type: 'object', $defs: { line: { type: 'object', required: ['qty'], additionalProperties: false, properties: { qty: { type: 'integer', minimum: 1, default: 1 }, price: { type: 'number' } } } }, properties: { lines: { type: 'array', items: { $ref: '#/$defs/line' } }, note: { type: ['string', 'null'] }, rush: { type: 'boolean' } } },
  { $id: 'nested', type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { n: { type: 'number', default: 0 }, s: { type: 'string', maxLength: 3 } }, additionalProperties: false } } }, list: { type: 'array', items: [{ type: 'integer' }, { type: 'boolean' }] } } },
]

let seed = 11
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (a) => a[Math.floor(rnd() * a.length)]
const leaf = () => pick([undefined, null, 0, 1, '1', '5', '13', 'x', '', 'true', 'false', true, false, 2.5, '2.5', [], ['1'], {}])
function gen (s, root, depth = 0) {
  if (depth > 4 || !s || typeof s !== 'object') return leaf()
  if (s.$ref) return gen(root.$defs[s.$ref.split('/').pop()], root, depth + 1)
  if (s.type === 'object' && rnd() < 0.9) {
    const o = {}
    for (const [k, p] of Object.entries(s.properties || {})) if (rnd() < 0.7) { const v = rnd() < 0.8 ? gen(p, root, depth + 1) : leaf(); if (v !== undefined) o[k] = v }
    if (rnd() < 0.3) o.extra = leaf() ?? 1
    return o
  }
  if (s.type === 'array' && rnd() < 0.9) return Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => gen(Array.isArray(s.items) ? s.items[i] : s.items, root, depth + 1))
  return leaf()
}

const shape = (r) => JSON.stringify({ valid: r.valid, errors: (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message]) })
const OPTIONS = [{}, { coerceTypes: true }, { coerceTypes: 'array' }, { removeAdditional: true }, { removeAdditional: 'all' }, { useDefaults: true }, { coerceTypes: true, removeAdditional: true, useDefaults: true }]
let cases = 0
for (const options of OPTIONS) {
  const fns = load(bundleStandalone(schemas, { ...options, order: true }))
  for (let i = 0; i < schemas.length; i++) {
    const runtime = new Validator(schemas[i], { useDefaults: false, ...options, schemas })
    for (let k = 0; k < 400; k++) {
      const d = gen(schemas[i], schemas[i])
      const a = structuredClone(d), b = structuredClone(d)
      const ra = runtime.validate(a), rb = fns[i](b)
      const where = `${JSON.stringify(options)} ${schemas[i].$id} ${JSON.stringify(d)}`
      assert.deepStrictEqual(b, a, `${where}: data afterwards`)
      assert.strictEqual(shape(rb), shape(ra), `${where}: answer`)
      cases++
    }
  }
}

// toStandaloneModule: the validator's own coerceTypes and removeAdditional run
// before the check, as the validator runs them. Defaults stay as they were:
// validate() does not fill them, applyDefaults does.
const { toStandaloneModule } = require('../build.js')
let single = 0
for (const options of [{ coerceTypes: true }, { coerceTypes: 'array' }, { removeAdditional: true }, { removeAdditional: 'all' }, { coerceTypes: true, removeAdditional: true }]) {
  for (const schema of schemas) {
    const runtime = new Validator(schema, { useDefaults: false, ...options, schemas })
    const src = toStandaloneModule(schema, { ...options, schemas, format: 'cjs' })
    assert.ok(src, 'a module is written')
    const mod = load(src)
    for (let k = 0; k < 200; k++) {
      const d = gen(schema, schema)
      const a = structuredClone(d), b = structuredClone(d), c = structuredClone(d)
      const ra = runtime.validate(a), rb = mod.validate(b)
      const where = `toStandaloneModule ${JSON.stringify(options)} ${schema.$id} ${JSON.stringify(d)}`
      assert.deepStrictEqual(b, a, `${where}: data afterwards`)
      assert.strictEqual(rb.valid, ra.valid, `${where}: verdict`)
      assert.strictEqual(mod.isValid(c), ra.valid, `${where}: isValid`)
      assert.deepStrictEqual(c, a, `${where}: data after isValid`)
      single++
    }
  }
}
assert.throws(() => toStandaloneModule({ type: 'array', items: { type: 'integer' } }, { coerceTypes: true }), /coerceTypes cannot be compiled/)

// applyDefaults is the runtime's defaults pass and validate does not run it
// unless asked.
{
  const fns = load(bundleStandalone(schemas))
  assert.strictEqual(typeof fns[0].applyDefaults, 'function')
  const d = { age: 20 }
  assert.strictEqual(fns[0](structuredClone(d)).valid, false, 'without useDefaults the missing name is missing')
  const filled = structuredClone(d)
  fns[0].applyDefaults(filled)
  const runtime = structuredClone(d)
  assert.strictEqual(new Validator(schemas[0]).validate(runtime).valid, true)
  assert.deepStrictEqual(filled, runtime, 'applyDefaults fills what the runtime fills')
  assert.strictEqual(fns[0](filled).valid, true)
  const plain = load(bundleStandalone([{ $id: 'p', type: 'object', properties: { a: { type: 'string' } } }]))[0]
  assert.strictEqual(plain.applyDefaults, undefined, 'no applyDefaults without a default')
}

// Refused where the generated pass cannot carry what the runtime would do.
assert.throws(() => bundleStandalone([{ $id: 'r', type: 'array', items: { type: 'integer' } }], { coerceTypes: true }), /coerceTypes cannot be compiled/)
// Nothing to carry: a scalar root, which the runtime does not change either.
{
  const f = load(bundleStandalone([{ $id: 'q', type: 'integer' }], { coerceTypes: true }))[0]
  assert.strictEqual(f('5').valid, new Validator({ type: 'integer' }, { coerceTypes: true }).validate('5').valid)
}

console.log(`ok: bundleStandalone carries coerceTypes, removeAdditional and defaults as the runtime runs them; ${cases} cases, and toStandaloneModule ${single}`)
