'use strict'

// Defaults and coercion below the top level are applied the same way whichever
// engine compiled the schema. The generated preprocess pass only reached
// top-level properties, and the closure pass the interpreted engine uses
// follows nested `properties`, so a nested default was filled on one engine and
// not the other: SchemaStore's airlock-microgateway schema accepted its sample
// document on the default engine and rejected it on the interpreted one.
// Seeded random nested schemas, compared on verdict and on the rewritten data.

const assert = require('assert')
const { Validator } = require('..')

let x = 0x5eed1
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k }
const pick = (a) => a[rnd(a.length)]
function node (depth) {
  const props = {}
  for (const k of ['a', 'b', 'c']) {
    if (rnd(3) === 0) continue
    if (depth > 0 && rnd(2) === 0) props[k] = node(depth - 1)
    else {
      const leaf = pick([{ type: 'integer' }, { type: 'string', minLength: 2 }, { type: 'boolean' }, { type: 'number', maximum: 10 }])
      if (rnd(2) === 0) leaf.default = pick([1, 'xy', 'z', true, 20, 3.5])
      props[k] = leaf
    }
  }
  const s = { type: 'object', properties: props }
  if (rnd(4) === 0) s.default = {}
  return s
}
function doc (schema, depth) {
  const o = {}
  for (const [k, p] of Object.entries(schema.properties || {})) {
    if (rnd(3) === 0) continue
    o[k] = p.properties && depth > 0 ? doc(p, depth - 1) : pick(['5', 5, 'true', true, 'ab', 12, null])
  }
  return o
}

let compared = 0
for (let i = 0; i < 600; i++) {
  const schema = node(3)
  for (const options of [{}, { coerceTypes: true }, { useDefaults: false, coerceTypes: true }]) {
    const fast = new Validator(schema, options)
    const interp = new Validator(schema, { ...options, engine: 'interpreter' })
    for (let j = 0; j < 4; j++) {
      const d = doc(schema, 3)
      const a = structuredClone(d), b = structuredClone(d)
      const va = fast.validate(a).valid, vb = interp.validate(b).valid
      assert.strictEqual(va, vb, `verdict differs: ${JSON.stringify(schema)} ${JSON.stringify(options)} on ${JSON.stringify(d)}`)
      assert.strictEqual(JSON.stringify(a), JSON.stringify(b), `rewritten data differs: ${JSON.stringify(schema)} ${JSON.stringify(options)} on ${JSON.stringify(d)}`)
      compared++
    }
  }
}
console.log(`ok: nested defaults and coercion agree across engines on ${compared} documents`)
