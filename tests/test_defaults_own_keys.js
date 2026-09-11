'use strict'

// A default fills a property the instance does not carry. Both engines used
// to ask `key in data`, which also answers for what the instance inherits:
// a property named `constructor` never received its default, and one named
// `__proto__` sent its nested defaults to Object.prototype — the interpreter's
// applier walked data.__proto__ as the parent. A property is an own key or
// absent.

const assert = require('assert')
const { Validator } = require('../index.js')

let pass = 0
function ok (name, fn) {
  fn()
  pass++
  console.log('  PASS ', name)
}

const ctor = {
  type: 'object',
  properties: {
    constructor: { type: 'string', default: 'x' },
    nested: {
      type: 'object',
      default: {},
      properties: { constructor: { type: 'string', default: 'y' } },
    },
  },
}

// an own `__proto__` key in properties: only JSON.parse writes one
const proto = JSON.parse(
  '{"type":"object","properties":{"__proto__":{"type":"object","default":{},"properties":{"polluted":{"type":"boolean","default":true}}}}}'
)

for (const engine of ['auto', 'interpreter']) {
  ok(`${engine}: a property named constructor receives its default`, () => {
    const v = new Validator(ctor, { engine, useDefaults: true })
    const data = {}
    assert.strictEqual(v.validate(data).valid, true)
    assert.strictEqual(data.constructor, 'x')
    assert.strictEqual(Object.hasOwn(data, 'constructor'), true)
  })

  ok(`${engine}: a default under __proto__ never lands on Object.prototype`, () => {
    const v = new Validator(proto, { engine, useDefaults: true })
    v.validate({})
    assert.strictEqual(Object.hasOwn(Object.prototype, 'polluted'), false)
    assert.strictEqual(({}).polluted, undefined)
  })
}

// the interpreter's applier walks nested properties; the parent it walks is
// an own key too
ok('interpreter: a nested property named constructor receives its default', () => {
  const v = new Validator(ctor, { engine: 'interpreter', useDefaults: true })
  const data = {}
  assert.strictEqual(v.validate(data).valid, true)
  assert.deepStrictEqual(Object.entries(data), [['constructor', 'x'], ['nested', { constructor: 'y' }]])
})

console.log(`\n${pass} passed`)
