'use strict'

// A oneOf whose branches each allow only their own properties (Traefik's
// middlewares, tagged unions written as `{ properties: { kind: ... },
// additionalProperties: false }`) is answered by the branch the object's
// first key names, instead of trying every branch. These hold the generated
// verdict to the interpreter on the shapes where that shortcut could go wrong.

const assert = require('assert')
const { Validator } = require('..')

const branch = (k, s, extra) => ({ properties: { [k]: s }, additionalProperties: false, ...(extra || {}) })
const schemas = {
  plain: { oneOf: [branch('a', { type: 'string' }), branch('b', { type: 'integer', minimum: 1 }), branch('c', { type: 'object', required: ['x'] }), branch('d', { type: 'array' })] },
  typed: { oneOf: [branch('a', { type: 'string' }, { type: 'object' }), branch('b', { type: 'integer' }, { type: 'object' }), branch('c', { const: 1 }, { type: 'object' }), branch('d', {}, { type: 'object' })] },
  // A branch with two properties: an object with both keys still goes to it.
  wide: { oneOf: [{ properties: { a: { type: 'string' }, a2: { type: 'number' } }, additionalProperties: false }, branch('b', { type: 'integer' }), branch('c', { type: 'boolean' }), branch('d', { type: 'null' })] },
  nested: { type: 'object', properties: { m: { type: 'array', items: { oneOf: [branch('add', { type: 'object', properties: { p: { type: 'string' } }, required: ['p'] }), branch('strip', { type: 'array', items: { type: 'string' } }), branch('retry', { type: 'object', properties: { n: { type: 'integer', minimum: 0 } } }), branch('auth', { type: 'object', additionalProperties: false, properties: { u: { type: 'string' } } }), branch('__proto__', { type: 'string' })] } } } },
}
const docs = [
  {}, { a: 'x' }, { a: 1 }, { b: 2 }, { b: 0 }, { c: { x: 1 } }, { c: {} }, { d: [] }, { d: 1 },
  { a: 'x', b: 2 }, { b: 2, a: 'x' }, { z: 1 }, { z: 1, a: 'x' }, { a: 'x', z: 1 }, { a: 'x', a2: 1 }, { a2: 1 }, { a2: 'x' },
  null, 1, 'a', [], [{ a: 'x' }], true, JSON.parse('{"__proto__":"x"}'), JSON.parse('{"__proto__":1}'), { c: 1 }, { d: null },
]
const nestedDocs = [
  { m: [] }, { m: [{ add: { p: 'x' } }] }, { m: [{ add: {} }] }, { m: [{ strip: ['a'] }, { retry: { n: 1 } }] }, { m: [{ retry: { n: -1 } }] },
  { m: [{ auth: { u: 'a' } }, { auth: { u: 'a', v: 1 } }] }, { m: [{}] }, { m: [{ add: { p: 'x' }, strip: [] }] }, { m: [{ nope: 1 }] }, { m: [1] },
  { m: [JSON.parse('{"__proto__":"x"}')] }, { m: [JSON.parse('{"__proto__":2}')] },
]

let cases = 0
for (const [name, schema] of Object.entries(schemas)) {
  const code = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  assert.strictEqual(code.engine(), 'codegen', name + ' compiles')
  // The shortcut is in the generated verdict, not only the loop.
  code.isValidObject({})
  assert.ok(/_ofm\d+\.get\(/.test(String(code._jsFn)), name + ' uses the first-key dispatch')
  for (const d of name === 'nested' ? nestedDocs : docs) {
    cases++
    const want = interp.isValidObject(d)
    assert.strictEqual(code.isValidObject(d), want, `${name} isValidObject ${JSON.stringify(d)}`)
    assert.strictEqual(code.validate(d).valid, want, `${name} validate ${JSON.stringify(d)}`)
  }
}
console.log(`ok: a keyed oneOf answers as the interpreter on ${cases} documents`)

// Shapes the shortcut must leave alone: a required list, a property in two
// branches, a branch without additionalProperties: false. Their answers come
// from the loop over every branch and still match the interpreter.
for (const schema of [
  { oneOf: [{ ...branch('a', {}), required: ['a'] }, branch('b', {}), branch('c', {}), branch('d', {})] },
  { oneOf: [branch('a', {}), branch('a', { type: 'string' }), branch('c', {}), branch('d', {})] },
  { oneOf: [{ properties: { a: {} } }, branch('b', {}), branch('c', {}), branch('d', {})] },
]) {
  const code = new Validator(schema), interp = new Validator(schema, { engine: 'interpreter' })
  for (const d of docs) assert.strictEqual(code.isValidObject(d), interp.isValidObject(d), JSON.stringify(schema) + ' ' + JSON.stringify(d))
}
console.log('ok: oneOf shapes outside the shortcut keep their answers')
