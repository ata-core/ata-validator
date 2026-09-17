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

// a `__proto__` in properties with no default of its own: the applier used
// to walk data.__proto__ (Object.prototype) as the parent and write the
// child default there. The worst shape, because nothing needs to be present
// in the input at all.
const protoNoParentDefault = JSON.parse(
  '{"type":"object","properties":{"__proto__":{"type":"object","properties":{"polluted_walk":{"type":"boolean","default":true}}}}}'
)

ok('a property named constructor receives its default', () => {
  const v = new Validator(ctor, { useDefaults: true })
  const data = {}
  assert.strictEqual(v.validate(data).valid, true)
  assert.strictEqual(data.constructor, 'x')
  assert.strictEqual(Object.hasOwn(data, 'constructor'), true)
})

ok('a default under __proto__ never lands on Object.prototype', () => {
  const v = new Validator(proto, { useDefaults: true })
  const data = {}
  v.validate(data)
  assert.strictEqual(Object.hasOwn(Object.prototype, 'polluted'), false)
  assert.strictEqual(({}).polluted, undefined)
  // and the instance's own prototype was not rewritten by the parent fill
  assert.strictEqual(Object.getPrototypeOf(data), Object.prototype)
})

ok('a __proto__ parent the instance does not carry is not walked', () => {
  const v = new Validator(protoNoParentDefault, { useDefaults: true })
  v.validate({})
  assert.strictEqual(Object.hasOwn(Object.prototype, 'polluted_walk'), false)
  assert.strictEqual(({}).polluted_walk, undefined)
})

// The interpreted engine applies defaults through the closure mutators.
// There is no per-validator switch on this tree, so the engine is selected
// the way a CSP page selects it: in a child process with code generation
// blocked. An infinite loop or a pollution there must not take this test
// down with it, hence the subprocess.
{
  const { execFileSync } = require('node:child_process')
  const script = `
    const assert = require('assert')
    const { Validator } = require(${JSON.stringify(require.resolve('../index.js'))})
    const ctor = ${JSON.stringify(ctor)}
    const proto = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"object","default":{},"properties":{"polluted":{"type":"boolean","default":true}}}}}')
    const walk = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"object","properties":{"polluted_walk":{"type":"boolean","default":true}}}}}')
    const data = {}
    assert.strictEqual(new Validator(ctor, { useDefaults: true }).validate(data).valid, true)
    assert.deepStrictEqual(Object.entries(data), [['constructor', 'x'], ['nested', { constructor: 'y' }]])
    new Validator(proto, { useDefaults: true }).validate({})
    new Validator(walk, { useDefaults: true }).validate({})
    assert.strictEqual(Object.hasOwn(Object.prototype, 'polluted'), false)
    assert.strictEqual(Object.hasOwn(Object.prototype, 'polluted_walk'), false)
    console.log('child ok')
  `
  const out = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '-e', script], { encoding: 'utf8' })
  assert.ok(out.includes('child ok'))
  pass++
  console.log('  PASS  interpreter (codegen blocked): own-key defaults, nested fill, no pollution')
}

console.log(`\n${pass} passed`)
