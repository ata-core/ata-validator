'use strict'

// With coerceTypes, values are coerced at every depth the default validator
// reaches: properties of nested objects and elements under `items`. ata used
// to coerce only top-level properties, so with Fastify's options a nested body
// such as `{ address: { zip: 34000 } }` was rejected where the default
// validator coerced it and accepted. Seeded random nested schemas are run
// through the default validator and through both ata engines; the verdict and
// the coerced data must match.
//
// This test is about reach, not about the rules for each value, which differ
// in a few places (null, and the strings "1" and "0" to boolean); the values
// used here are ones both coerce the same way.

const assert = require('assert')
const Ajv = require('ajv')
const { Validator } = require('..')

let x = 0xc0e5ce
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k }
const pick = (a) => a[rnd(a.length)]
const SCALARS = ['number', 'integer', 'string', 'boolean']
function schemaAt (depth) {
  const r = rnd(depth > 0 ? 6 : 4)
  if (r < 4) return { type: SCALARS[r] }
  if (r === 4) {
    const properties = {}
    for (const k of ['a', 'b', 'c']) if (rnd(3)) properties[k] = schemaAt(depth - 1)
    const s = { properties }
    if (rnd(2)) s.type = 'object'
    return s
  }
  const s = { items: schemaAt(depth - 1) }
  if (rnd(2)) s.type = 'array'
  return s
}
function valueFor (schema, depth) {
  if (schema.properties) {
    const o = {}
    for (const k of Object.keys(schema.properties)) if (rnd(4)) o[k] = valueFor(schema.properties[k], depth - 1)
    return o
  }
  if (schema.items) return Array.from({ length: rnd(3) }, () => valueFor(schema.items, depth - 1))
  return pick(['5', '2.5', 7, 3.5, 'true', 'false', true, false, 'abc', ''])
}

const ajv = new Ajv({ coerceTypes: true, allErrors: true, strict: false })
let compared = 0
for (let i = 0; i < 400; i++) {
  const schema = { type: 'object', properties: { p: schemaAt(3), q: schemaAt(3) } }
  const check = ajv.compile(structuredClone(schema))
  const fast = new Validator(structuredClone(schema), { coerceTypes: true })
  const interp = new Validator(structuredClone(schema), { coerceTypes: true, engine: 'interpreter' })
  for (let j = 0; j < 6; j++) {
    const doc = { p: valueFor(schema.properties.p, 3), q: valueFor(schema.properties.q, 3) }
    const a = structuredClone(doc), b = structuredClone(doc), c = structuredClone(doc)
    const va = check(a), vb = fast.validate(b).valid, vc = interp.validate(c).valid
    const where = `${JSON.stringify(schema)} on ${JSON.stringify(doc)}`
    assert.strictEqual(vb, va, `verdict, default engine: ${where}`)
    assert.strictEqual(vc, va, `verdict, interpreted engine: ${where}`)
    if (va) {
      assert.strictEqual(JSON.stringify(b), JSON.stringify(a), `coerced data, default engine: ${where}`)
      assert.strictEqual(JSON.stringify(c), JSON.stringify(a), `coerced data, interpreted engine: ${where}`)
    }
    compared++
  }
}
console.log(`ok: nested coercion matches the default validator on ${compared} documents, both engines`)
