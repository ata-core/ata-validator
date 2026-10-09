'use strict'

// A standalone module reports errors in the public shape and nothing else.
// The error collector stamps `_o`, the ordinal the runtime sorts errors by,
// on every error literal; a module returns the collector's list as it is and
// never sorts it, so the field leaked into every error a default module
// reported (1.47.0 and 1.48.0), and a consumer comparing error objects saw a
// key the documentation does not have. Held here for the default and the
// one-pass module, through validate() and validateJSON(), and the bundle.

const assert = require('node:assert')
const { Validator } = require('..')
const { toStandaloneModule, bundleStandalone } = require('../build')

const schema = {
  type: 'object',
  required: ['email', 'name', 'age'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 13 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    choice: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  },
}
const docs = [{ email: 'nope', name: '', age: 7 }, { email: 'a@b.co', name: 'x', age: 20, extra: 1, tags: ['a', 'b', 'c'], choice: true }, {}]
const PUBLIC = new Set(['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'docUrl', 'dataFrame', 'branchErrors', 'path'])

function load (src) {
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, require)
  return m.exports
}
function check (label, errors) {
  assert.ok(errors.length > 0, label + ' reports errors')
  for (const e of errors) {
    const odd = Object.keys(e).filter((k) => !PUBLIC.has(k))
    assert.deepStrictEqual(odd, [], `${label}: error carries keys outside the public shape: ${odd.join(', ')}`)
    if (Array.isArray(e.branchErrors)) check(label + ' branch', e.branchErrors)
  }
}
let checked = 0
for (const [name, opts] of [['default', {}], ['onePass', { onePass: true }], ['positions', { positions: true }], ['onePass+positions', { positions: true, onePass: true }]]) {
  const mod = load(toStandaloneModule(new Validator(schema), { format: 'cjs', ...opts }))
  for (const d of docs) {
    check(name + ' validate', mod.validate(d).errors); checked++
    if (mod.validateJSON) { check(name + ' validateJSON', mod.validateJSON(JSON.stringify(d)).errors); checked++ }
  }
}
const bundle = load(bundleStandalone([{ $id: 'u', ...schema }], { format: 'cjs' }))
const list = Array.isArray(bundle) ? bundle : Array.isArray(bundle.validators) ? bundle.validators : Array.isArray(bundle.default) ? bundle.default : null
assert.ok(list && typeof list[0] === 'function', 'the bundle exports its validators as a list')
const fn = list[0]
for (const d of docs) { check('bundle', fn(d).errors); checked++ }
console.log(`ok: standalone modules report errors in the public shape only (${checked} lists over four module kinds and a bundle)`)
