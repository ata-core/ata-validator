'use strict'

// Properties named like Object.prototype members (__proto__, constructor,
// toString, valueOf, hasOwnProperty) are generated: presence is tested with
// hasOwnProperty and a value read off the prototype is never taken for the
// document's. They used to send the whole schema to the interpreter. Held to
// the interpreter on every read, under defaults, removal and coercion, with
// documents parsed from text so `__proto__` is an own key, and the prototype
// checked untouched after defaults were applied.

const assert = require('node:assert')
const { Validator } = require('..')

const keys = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']
const schemas = []
for (const k of keys) {
  schemas.push({ type: 'object', properties: { [k]: { type: 'number' } }, required: [k] })
  schemas.push({ type: 'object', properties: { [k]: { type: 'string', default: 'd' }, a: { type: 'integer' } } })
  schemas.push({ type: 'object', properties: { [k]: { type: 'object', properties: { x: { type: 'integer' } } } }, additionalProperties: false })
  schemas.push({ type: 'object', dependentRequired: { [k]: ['a'] }, properties: { a: { const: 1 } } })
}
const texts = keys.flatMap((k) => [`{"${k}":1}`, `{"${k}":"s"}`, `{"${k}":{"x":1}}`, `{"${k}":{"x":"y"}}`, `{"${k}":null,"a":2}`]).concat(['{}', '{"a":1}', '{"b":1}'])
let compared = 0, generated = 0
for (const [i, s] of schemas.entries()) {
  for (const opts of [{}, { richErrors: false }, { useDefaults: true }, { removeAdditional: true }, { coerceTypes: true }]) {
    const a = new Validator(s, opts)
    const b = new Validator(s, { ...opts, engine: 'interpreter' })
    for (let r = 0; r < 70; r++) for (const t of texts) { void a.validate(JSON.parse(t)).errors; a.isValidJSON(t) }
    if (a.engine() === 'codegen') generated++
    for (const t of texts) {
      const da = JSON.parse(t), db = JSON.parse(t)
      const x = a.validate(da), y = b.validate(db)
      const label = `schema ${i} ${JSON.stringify(opts)} ${t}`
      assert.strictEqual(x.valid, y.valid, 'verdict, ' + label)
      assert.strictEqual(JSON.stringify(x.errors), JSON.stringify(y.errors), 'errors, ' + label)
      assert.strictEqual(JSON.stringify(da), JSON.stringify(db), 'document after the pass, ' + label)
      assert.strictEqual(Object.getPrototypeOf(da), Object.prototype, 'prototype, ' + label)
      assert.strictEqual(a.isValidObject(JSON.parse(t)), y.valid, 'isValidObject, ' + label)
      assert.strictEqual(a.isValidJSON(t), y.valid, 'isValidJSON, ' + label)
      assert.strictEqual(JSON.stringify(a.validateJSON(t).errors), JSON.stringify(b.validateJSON(t).errors), 'validateJSON, ' + label)
      compared++
    }
  }
}
assert.strictEqual(Object.prototype.x, undefined)
assert.strictEqual(({}).a, undefined)
assert.ok(generated >= 80, `expected most of these validators on generated code, got ${generated} of ${schemas.length * 5}`)
console.log(`ok: properties named like Object.prototype members agree with the interpreter (${compared} documents, ${generated} of ${schemas.length * 5} validators on generated code)`)
