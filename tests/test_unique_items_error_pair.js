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
