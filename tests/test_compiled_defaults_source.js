'use strict'
// Where the compiled wrappers take their defaults pass from (lib/compiled-common.js):
// a module stamped 1.58.0 or later fills its own (`applyDefaults`, exported
// when its schema has a default), so the defaults engine stays out of a bundle
// that wraps current modules; an older module, or one without the stamp,
// takes the runtime's pass as before. The browser build maps that fallback to
// a stub that refuses such a module, checked here through the package map.
const assert = require('assert')
const { fromCompiled } = require('../lib/compiled')
const { fromCompiledVerdict } = require('../lib/compiled-verdict')
const { fromCompiledObject } = require('../lib/compiled-object')
const pkg = require('../package.json')

const schema = { type: 'object', properties: { a: { type: 'string', default: 'x' }, n: { type: 'integer', default: 3 } } }
const isValid = (d) => d !== null && typeof d === 'object' && typeof d.a === 'string'
const validate = (d) => (isValid(d) ? { valid: true, errors: [] } : { valid: false, errors: [{ keyword: 'type', instancePath: '/a', schemaPath: '#/properties/a/type', params: { type: 'string' }, message: 'must be string' }] })

for (const wrap of [fromCompiled, fromCompiledVerdict, fromCompiledObject]) {
  // Current module: its own pass is used, and only it.
  let calls = 0
  const current = { isValid, validate, ataVersion: '1.61.0', applyDefaults: (d) => { calls++; if (d && typeof d === 'object' && d.a === undefined) d.a = 'mod' } }
  const d1 = {}
  assert.strictEqual(wrap(current, schema).isValidObject(d1), true)
  assert.strictEqual(d1.a, 'mod', `${wrap.name}: the module's own pass fills the document`)
  assert.strictEqual(calls, 1)
  // Current module whose schema has no default: nothing is filled.
  const none = { isValid, validate, ataVersion: '1.58.0' }
  const d2 = { a: 's' }
  wrap(none, schema).isValidObject(d2)
  assert.deepStrictEqual(d2, { a: 's' }, `${wrap.name}: a current module without applyDefaults has nothing to fill`)
  // Older or unstamped module: the runtime's pass, as before.
  for (const old of [{ isValid, validate, ataVersion: '1.57.0' }, { isValid, validate }]) {
    const d3 = {}
    assert.strictEqual(wrap(old, schema).isValidObject(d3), true)
    assert.deepStrictEqual(d3, { a: 'x', n: 3 }, `${wrap.name}: ${old.ataVersion || 'unstamped'} module takes the runtime's pass`)
  }
  // useDefaults: false leaves the input alone either way.
  const d4 = {}
  wrap(current, schema, { useDefaults: false }).isValidObject(d4)
  assert.deepStrictEqual(d4, {})
}

// The browser build refuses an old module with defaults rather than skip them.
assert.strictEqual(pkg.browser['./lib/compiled-defaults.js'], './lib/compiled-defaults.browser.js')
const stub = require('../lib/compiled-defaults.browser.js')
assert.throws(() => stub(schema), /built before ata-validator 1\.58\.0/)
console.log('ok: compiled wrappers take a current module\'s own defaults pass, older modules the runtime\'s')
