'use strict'

// A default fills a property the instance does not have, and a key holding
// undefined is a property it does not have: `required` reads it as missing,
// JSON.stringify drops it, and ajv's useDefaults fills it. The defaults pass
// asked only whether the key was the object's own, so `{ a: undefined }`
// kept its undefined and then failed `required: ['a']`, and a nested object
// built with optional fields left unset got none of its defaults. Every pass
// fills it now: the generated one, the closure one, ata-validator/ir's
// module and closures, and parse().

const assert = require('assert')
const { Validator } = require('../index.js')

let pass = 0
function ok (name, fn) {
  fn()
  pass++
  console.log('  PASS ', name)
}

const show = (d) => JSON.stringify(d, (k, v) => (v === undefined ? '<undefined>' : v))

const schema = JSON.parse(JSON.stringify({
  type: 'object',
  required: ['a'],
  properties: {
    a: { type: 'number', default: 1 },
    constructor: { type: 'string', default: 'c' },
    PROTO_KEY: { type: ['object', 'null'], default: { x: 1 } },
    n: { type: 'object', properties: { b: { type: 'string', default: 'x' } } },
    z: { default: null },
  },
  dependentSchemas: { t: { properties: { u: { default: 'u' } } } },
}).replace('"PROTO_KEY"', '"__proto__"'))

// Each document beside what the fill leaves in it.
const cases = () => [
  [{ a: undefined }, { a: 1, constructor: 'c', ['__proto__']: { x: 1 }, z: null }],
  [{ a: 2, n: { b: undefined } }, { a: 2, n: { b: 'x' }, constructor: 'c', ['__proto__']: { x: 1 }, z: null }],
  [JSON.parse('{"a":3,"__proto__":null}'), { a: 3, ['__proto__']: null, constructor: 'c', z: null }],
  [{ a: 4, constructor: undefined, z: undefined }, { a: 4, constructor: 'c', z: null, ['__proto__']: { x: 1 } }],
  [{ a: 5, z: null, t: 1, u: undefined }, { a: 5, z: null, t: 1, u: 'u', constructor: 'c', ['__proto__']: { x: 1 } }],
  [{ a: 6, t: undefined }, { a: 6, t: undefined, constructor: 'c', ['__proto__']: { x: 1 }, z: null }],
  [Object.assign(Object.create(null), { a: undefined }), { a: 1, constructor: 'c', ['__proto__']: { x: 1 }, z: null }],
]

// An object literal cannot write an own "__proto__" key, so the expected
// documents are compared by their own entries, sorted.
const entries = (o) => show(Object.getOwnPropertyNames(o).sort().map((k) => [k, o[k]]))
const expected = (o) => {
  const out = {}
  for (const k of Object.keys(o)) Object.defineProperty(out, k, { value: o[k], enumerable: true, writable: true, configurable: true })
  return out
}

for (const engine of [undefined, 'interpreter']) {
  ok(`${engine || 'default engine'}: a key holding undefined takes its default`, () => {
    const v = new Validator(schema, { useDefaults: true, engine })
    // Past the tier, so both the first and the fully compiled pass run.
    for (let call = 0; call < 200; call++) {
      for (const [doc, want] of cases()) {
        const r = v.validate(doc)
        assert.strictEqual(r.valid, true, `call ${call}: ${show(doc)}: ${show(r.errors)}`)
        assert.strictEqual(entries(doc), entries(expected(want)), `call ${call}: filled`)
      }
    }
    assert.strictEqual(({}).x, undefined, 'nothing leaked onto Object.prototype')
  })
}

ok('without useDefaults a key holding undefined is still missing', () => {
  const v = new Validator(schema, { useDefaults: false })
  const doc = { a: undefined }
  assert.strictEqual(v.validate(doc).valid, false)
  assert.ok(Object.hasOwn(doc, 'a') && doc.a === undefined)
})

ok('parse() copies the default for a key holding undefined', () => {
  const s = { type: 'object', properties: { a: { type: 'number', default: 1 }, n: { type: 'object', properties: { b: { type: 'string', default: 'x' } } } } }
  const v = new Validator(s, { useDefaults: true })
  assert.strictEqual(show(v.parse({ a: undefined, n: { b: undefined } })), show({ a: 1, n: { b: 'x' } }))
  assert.strictEqual(show(v.parse({ a: 2, n: {} })), show({ a: 2, n: { b: 'x' } }))
})

// ata-validator/ir fills through its own module writer and closures; both
// are held to the runtime's pass.
const ir = import('../lib/ir/index.mjs')
const emit = import('../lib/ir/emit.mjs')
const kernels = import('../lib/kernels/index.mjs')
Promise.all([ir, emit, kernels]).then(([{ compileClosures, specialize }, { functionBody }, K]) => {
  ok('ata-validator/ir: a key holding undefined takes its default', () => {
    const plain = { type: 'object', required: ['a'], properties: { a: { type: 'number', default: 1 }, n: { type: 'object', properties: { b: { type: 'string', default: 'x' } } } } }
    const forty = { type: 'object', properties: Object.fromEntries([...Array(40)].map((_, i) => ['o' + i, { default: i }])) }
    for (const s of [plain, forty]) {
      const mod = new Function('K', functionBody(specialize(s, { assertFormat: false, useDefaults: true, verdict: true })))(K)
      const clo = compileClosures(s, { assertFormat: false, useDefaults: true })
      const ata = new Validator(s, { useDefaults: true })
      const make = () => ({ a: undefined, n: { b: undefined }, o3: undefined, o35: undefined, o36: null })
      const x = make(); const y = make(); const z = make()
      ata.validate(x); mod.validate(y); clo.validate(z)
      assert.strictEqual(entries(y), entries(x), 'module')
      assert.strictEqual(entries(z), entries(x), 'closures')
      assert.notStrictEqual(x.a === undefined && x.o3 === undefined, true, 'the runtime filled nothing, so the case under test did not run')
    }
  })
  console.log(`\n${pass} passed`)
}).catch((e) => { console.error(e); process.exit(1) })
