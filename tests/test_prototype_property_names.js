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

// unevaluatedProperties: false where the evaluated names are tracked at run
// time (a pattern beside declared names, branches, a lone if,
// dependentSchemas): the map of evaluated names must not inherit from
// Object.prototype, or a key named `constructor` reads as evaluated and the
// document is accepted. Held to the interpreter on every path, standalone
// modules included.
{
  const { toStandaloneModule } = require('../build')
  const shapes = [
    { type: 'object', properties: { a: {} }, patternProperties: { '^x': {} }, unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, allOf: [{ patternProperties: { '^x': {} } }], unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, if: { patternProperties: { '^x': {} } }, unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, if: { properties: { b: {} } }, unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, if: { required: ['a'] }, then: { patternProperties: { '^x': {} } }, else: { properties: { c: {} } }, unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, anyOf: [{ patternProperties: { '^x': {} } }, { properties: { b: {} } }], unevaluatedProperties: false },
    { type: 'object', oneOf: [{ properties: { a: {} }, required: ['a'] }, { properties: { b: {} }, required: ['b'] }], unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, dependentSchemas: { a: { patternProperties: { '^x': {} } } }, unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, dependentSchemas: { a: { properties: { b: {} } } }, unevaluatedProperties: false },
    { type: 'object', properties: { a: {} }, allOf: [{ patternProperties: { '^x': {} } }], unevaluatedProperties: { type: 'string' } },
    { type: 'object', properties: { o: { type: 'object', properties: { a: {} }, patternProperties: { '^x': {} }, unevaluatedProperties: false } } },
  ]
  const names = keys.concat(['__defineGetter__', 'isPrototypeOf', 'propertyIsEnumerable'])
  let n = 0
  let onCodegen = 0
  for (const schema of shapes) {
    const a = new Validator(schema)
    const b = new Validator(schema, { engine: 'interpreter' })
    let mod = null
    try { const src = toStandaloneModule(schema, { format: 'cjs' }); if (src) { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); mod = m.exports } } catch { mod = null }
    const texts = names.flatMap((k) => [`{"a":1,"${k}":1}`, `{"${k}":1}`, `{"x1":1,"${k}":1}`, `{"${k}":"s"}`, `{"o":{"a":1,"${k}":1}}`]).concat(['{"a":1,"x1":1}', '{"b":1}', '{"zz":1}'])
    for (let r = 0; r < 70; r++) for (const t of texts) a.validate(JSON.parse(t))
    if (a.engine() === 'codegen') onCodegen++
    for (const t of texts) {
      const want = b.validate(JSON.parse(t)).valid
      const label = `${JSON.stringify(schema)} on ${t}`
      assert.strictEqual(a.validate(JSON.parse(t)).valid, want, 'validate, ' + label)
      assert.strictEqual(a.isValidObject(JSON.parse(t)), want, 'isValidObject, ' + label)
      assert.strictEqual(a.isValidJSON(t), want, 'isValidJSON, ' + label)
      assert.strictEqual(a.validateJSON(t).valid, want, 'validateJSON, ' + label)
      if (mod) {
        assert.strictEqual(mod.isValid(JSON.parse(t)), want, 'standalone isValid, ' + label)
        assert.strictEqual(mod.validate(JSON.parse(t)).valid, want, 'standalone validate, ' + label)
      }
      n++
    }
  }
  assert.ok(onCodegen >= shapes.length - 2, `expected these shapes on generated code, got ${onCodegen} of ${shapes.length}`)
  console.log(`ok: unevaluatedProperties with run-time tracking agrees with the interpreter on prototype-named keys (${n} documents, ${onCodegen} of ${shapes.length} shapes on generated code)`)
}
