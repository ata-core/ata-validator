'use strict'

// The generated defaults pass decides "is this key an own property" by
// reading it first and asking Object.hasOwn only when the read gives
// undefined (plain objects, keys Object.prototype does not have). On a
// configuration schema of 82 defaults the hasOwn-for-every-key form cost
// 820 ns a call for a document that already carried every key; the read-first
// form costs 52. The shortcut must not change what gets written: this pins
// the generated pass to the closure pass (the interpreter's) on the documents
// where the two tests could differ, and checks the pass is the fast form.

const assert = require('assert')
const { Validator } = require('../index.js')

// `__proto__` as a key has to come through JSON.parse: in an object literal
// it would set the prototype instead of naming a property.
const schema = JSON.parse(JSON.stringify({
  type: 'object',
  properties: {
    a: { type: 'integer', default: 1 },
    constructor: { type: 'string', default: 'c' },
    toString: { default: 2 },
    PROTO_KEY: { type: 'object', default: { x: 1 } },
    nested: {
      type: 'object',
      properties: {
        b: { default: true },
        constructor: { default: 'n' },
        deep: { type: 'object', properties: { c: { default: [1] } } },
      },
    },
  },
}).replace('"PROTO_KEY"', '"__proto__"'))

class Custom { constructor () { this.own = 1 } }
Custom.prototype.a = 99
Custom.prototype.nested = { b: false }

const docs = () => [
  {},
  { a: undefined },
  { a: 5, nested: {} },
  { nested: { deep: {} } },
  { nested: { deep: { c: null } } },
  new Custom(),
  Object.assign(new Custom(), { nested: {} }),
  Object.create(null),
  Object.assign(Object.create(null), { nested: Object.create(null) }),
  { constructor: 'mine' },
  JSON.parse('{"__proto__":{"y":2}}'),
  { a: null, nested: null },
  { nested: [] },
]

const show = (o) => JSON.stringify(o, (k, v) => (v === undefined ? '<undefined>' : v)) +
  '|own:' + JSON.stringify(Object.getOwnPropertyNames(o).sort()) +
  '|proto:' + (Object.getPrototypeOf(o) === Object.prototype ? 'plain' : Object.getPrototypeOf(o) === null ? 'null' : 'custom')

const generated = new Validator(schema)
const closure = new Validator(schema, { engine: 'interpreter' })
const A = docs(), B = docs()
for (let i = 0; i < A.length; i++) {
  generated.validate(A[i])
  closure.validate(B[i])
  assert.strictEqual(show(A[i]), show(B[i]), `document ${i}: the generated pass and the closure pass wrote different defaults`)
}
assert.deepStrictEqual(Object.keys(Object.prototype), [], 'Object.prototype gained a key')
assert.strictEqual(({}).x, undefined)
assert.strictEqual(({}).y, undefined)

// The pass is the read-first form, and keys Object.prototype carries keep
// the hasOwn test alone.
const src = generated._applyDefaults.toString()
assert.ok(/\(d\["a"\]===undefined\|\|!_pk\d+\)&&!Object\.hasOwn\(d,"a"\)/.test(src), 'plain key is tested by a read before hasOwn')
assert.ok(/if\(!Object\.hasOwn\(d,"constructor"\)\)/.test(src), 'a key Object.prototype has keeps the hasOwn test')
assert.ok(/if\(!Object\.hasOwn\(d,"__proto__"\)\)Object\.defineProperty/.test(src), '__proto__ keeps hasOwn and defineProperty')
assert.ok(!/if\(Object\.hasOwn\(d,"nested"\)\)\{/.test(src), 'the descent into a nested object reads first too')

console.log(`defaults fast path: ${A.length} documents agree between the generated and the closure pass; the pass reads before it asks hasOwn`)
