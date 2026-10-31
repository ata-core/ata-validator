'use strict'

// A uniqueItems error names the duplicate pair. The error and combined
// generators find it with a hoisted helper that compares short arrays
// pairwise and longer ones by canonical string, and the pair it reports must
// be the one the interpreted engine reports, at either length and for any
// item type. Random arrays over a small value pool, so duplicates are common
// and land at every position.

const assert = require('node:assert')
const { Validator } = require('..')

let seed = 7
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const pool = [0, 1, -0, 1.5, 'a', 'b', '1', true, false, null, [], [1], [1, 2], {}, { a: 1 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { a: [1, { c: null }] }, { a: [1, { c: null }] }, [{ x: 1 }]]
const schemas = [
  { uniqueItems: true },
  { type: 'array', uniqueItems: true },
  { properties: { list: { uniqueItems: true } } },
  { items: { type: ['object', 'array', 'number', 'string', 'boolean', 'null'] }, uniqueItems: true },
]

let compared = 0, rejected = 0, generated = 0
for (const schema of schemas) {
  for (const richErrors of [true, false]) {
    const cg = new Validator(schema, { richErrors })
    const ip = new Validator(schema, { richErrors, engine: 'interpreter' })
    for (let t = 0; t < 600; t++) {
      const len = rnd(3) === 0 ? 13 + rnd(20) : rnd(13)
      const arr = Array.from({ length: len }, () => pool[rnd(pool.length)])
      const doc = schema.properties ? { list: arr } : arr
      const a = cg.validate(doc), b = ip.validate(doc)
      assert.strictEqual(a.valid, b.valid, JSON.stringify(doc))
      if (!a.valid) {
        rejected++
        assert.deepStrictEqual(JSON.parse(JSON.stringify(a.errors)), JSON.parse(JSON.stringify(b.errors)), `${JSON.stringify(schema)} ${JSON.stringify(doc)}`)
        // Second read goes through the one-pass path.
        assert.deepStrictEqual(JSON.parse(JSON.stringify(cg.validate(doc).errors)), JSON.parse(JSON.stringify(b.errors)))
      }
      compared++
    }
    if (cg.engine() === 'codegen') generated++
  }
}
assert.ok(rejected >= 2000, `too few rejections compared: ${rejected}`)
assert.strictEqual(generated, schemas.length * 2, 'every schema should compile')
console.log(`ok: uniqueItems error pairs match the interpreter (${compared} documents, ${rejected} rejected, short and long arrays)`)

// The generator hoists its own copy of the JSON equality the interpreted
// engine calls (DEQ_HELPER in lib/js-compiler.js, `_deq` in
// lib/unique-items.js). They must stay the same function: compare them, and
// node's own deep equality, over values that differ in key order, nesting,
// numbers that are equal as JSON, and keys holding undefined.
{
  const assert = require('assert')
  const { _deq } = require('../lib/unique-items')
  const hoisted = new Function(require('../lib/js-compiler')._helperSources.DEQ_HELPER + ';return _deq')()
  const vals = [1, 1.0, 0, -0, 2, 'a', '', null, true, false, [], {}, [1, 2], [2, 1], { a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1 },
    { a: [1, { b: null }] }, { a: [1, { b: null }] }, { a: [1, { b: 0 }] }, [{}], [[]], { a: undefined }, { b: undefined },
    { id: 1, tags: ['x'], name: 'n' }, { name: 'n', tags: ['x'], id: 1 }, { id: 1, tags: ['y'], name: 'n' }]
  let n = 0
  for (const x of vals) for (const y of vals) {
    assert.strictEqual(hoisted(x, y), _deq(x, y), `${JSON.stringify(x)} ${JSON.stringify(y)}`)
    const json = JSON.parse(JSON.stringify([x, y]))
    if (json.length === 2 && json[0] !== undefined && json[1] !== undefined) {
      assert.strictEqual(_deq(json[0], json[1]), require('util').isDeepStrictEqual(json[0], json[1]) || (json[0] === json[1]), `${JSON.stringify(x)} ${JSON.stringify(y)}`)
    }
    n++
  }
  console.log(`ok: the hoisted and the module JSON equality agree on ${n} pairs`)
}

// The structural hash keyed numbers by their integer part and nine decimal
// places, so every number below 1e-9 hashed alike and an array of such items
// fell back to comparing each one with all the others before it: 16000
// objects holding i * 1e-10 took seconds. Every bit of the number now goes
// into the hash, which keeps distinct numbers apart, and equal numbers (0
// and -0, 1 and 1.0) together.
{
  const { _uqh, _uq, _uqp } = require('../lib/unique-items')
  const tiny = [1e-10, 2e-10, 3e-10, 1e-300, 5e-324, 1e-15, 0.1, 0.2, 1.5, -1.5, 2 ** 40, 2 ** 40 + 0.5, 2 ** 33, 2 ** 34, 1.7e12, 1.7e12 + 1]
  assert.strictEqual(new Set(tiny.map(_uqh)).size, tiny.length, 'distinct numbers hash apart')
  // Families that differ only in the bits one shortcut or another would drop.
  const families = {
    'n * 2^32 + 0.5': (n) => n * 2 ** 32 + 0.5, 'n * 2^96': (n) => n * 2 ** 96, '2^-30 (1 + n 2^-52)': (n) => 2 ** -30 * (1 + n * 2 ** -52),
    '0.5 + n 2^-53': (n) => 0.5 + n * 2 ** -53, 'n * 5e-324': (n) => n * 5e-324, '1 + n 2^-52': (n) => 1 + n * 2 ** -52,
    '-(2^40) - n': (n) => -(2 ** 40) - n, '1.7e12 + n': (n) => 1.7e12 + n, '2^40 + n / 1024': (n) => 2 ** 40 + n / 1024,
  }
  for (const [name, g] of Object.entries(families)) {
    const hs = new Set()
    for (let n = 1; n <= 4000; n++) hs.add(_uqh(g(n)))
    assert.strictEqual(hs.size, 4000, name)
  }
  assert.strictEqual(_uqh(0), _uqh(-0))
  assert.strictEqual(_uqh(1), _uqh(1.0))
  assert.strictEqual(_uqh({ a: 1e-10 }), _uqh({ a: 1e-10 }))
  assert.strictEqual(_uqh(Infinity), _uqh(Infinity))

  const N = 16000
  const data = Array.from({ length: N }, (_, i) => ({ a: (i + 1) * 1e-10 }))
  let t0 = Date.now()
  assert.strictEqual(_uq(data), true)
  assert.strictEqual(_uqp(data), -1)
  const direct = Date.now() - t0
  assert.ok(direct < 500, `16000 tiny numbers took ${direct} ms`)
  const dup = data.concat([{ a: 5e-10 }])
  assert.strictEqual(_uq(dup), false)
  assert.strictEqual(_uqp(dup), N)

  // The same source is written into generated functions and standalone
  // modules; the module answers alike and in time.
  const schema = { type: 'array', uniqueItems: true, items: { type: 'object' } }
  const v = new Validator(schema)
  t0 = Date.now()
  assert.strictEqual(v.validate(data).valid, true)
  assert.strictEqual(v.validate(dup).valid, false)
  const { toStandaloneModule } = require('../build')
  const m = { exports: {} }
  new Function('module', 'exports', toStandaloneModule(schema, { format: 'cjs' }))(m, m.exports)
  assert.strictEqual(m.exports.isValid(data), true)
  assert.strictEqual(m.exports.isValid(dup), false)
  const r = m.exports.validate(dup)
  assert.strictEqual(r.valid, false)
  const ms = Date.now() - t0
  assert.ok(ms < 1500, `validator and module on 16000 tiny numbers took ${ms} ms`)
  console.log(`ok: numbers hash by their bits (${direct} ms direct, ${ms} ms validator and module)`)
}
