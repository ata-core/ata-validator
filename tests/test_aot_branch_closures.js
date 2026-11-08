'use strict'

// A oneOf or anyOf whose branches are small gets a verdict per branch, written
// by the boolean generator inside the error function. The patterns those
// verdicts test were bound as closure values, which a module from `ata build`
// does not carry: it carries the caller's format functions alone. The first
// document that reached such a branch's errors threw `_reN is not defined`
// (SchemaStore's github-workflow and bamboo-spec, found 2026-11-08 by the
// all-paths differential). Held here for patterns, safe-engine patterns and
// name sets, through validate() of a standalone module against the runtime.

const assert = require('node:assert')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

function load (src) {
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, require)
  return m.exports
}

const schemas = {
  'patternProperties in a oneOf branch': {
    type: 'object',
    properties: { s: { oneOf: [{ type: 'null' }, { type: 'object', patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false }] } },
  },
  'a safe-engine pattern in an anyOf branch': {
    type: 'object',
    properties: { s: { anyOf: [{ type: 'boolean' }, { type: 'object', patternProperties: { '^(a|b)+$': { type: 'integer' } } }] } },
  },
  'pattern in a oneOf branch': {
    properties: { s: { oneOf: [{ type: 'integer' }, { type: 'string', pattern: '^[a-z]{2,}$' }] } },
  },
  'enum in an anyOf branch': {
    properties: { s: { anyOf: [{ type: 'integer' }, { enum: ['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'black', 'white', 'grey'] }] } },
  },
}
const docs = [
  { s: null }, { s: { 'x-a': 'v' } }, { s: { 'x-a': 1 } }, { s: { y: 1 } }, { s: true }, { s: { ab: 1 } }, { s: { ab: 'x' } },
  { s: 3 }, { s: 'ab' }, { s: 'A1' }, { s: 'red' }, { s: 'pink' }, { s: [] }, {},
]

let n = 0
for (const [name, schema] of Object.entries(schemas)) {
  const v = new Validator(schema)
  const mod = load(toStandaloneModule(v, { format: 'cjs' }))
  for (const d of docs) {
    const want = v.validate(d)
    let got
    assert.doesNotThrow(() => { got = mod.validate(d) }, `${name}: the module's validate() on ${JSON.stringify(d)}`)
    assert.strictEqual(got.valid, want.valid, `${name}: verdict on ${JSON.stringify(d)}`)
    assert.strictEqual(got.errors.length > 0, !want.valid, `${name}: errors on ${JSON.stringify(d)}`)
    n++
  }
}
console.log(`ok: branch verdicts in a standalone module carry their constants, ${Object.keys(schemas).length} schemas, ${n} documents`)
