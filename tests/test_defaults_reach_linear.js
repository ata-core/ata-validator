'use strict'

// Whether a default is reachable from a schema is worked out once per schema,
// in linear time, by the closure pass (lib/defaults.js reachesDefault) and the
// generated one (lib/codegen-engine.js), which share it. The walk per question
// it replaces left a result resting on a recursive reference undecided and
// worked it out again each time: an allOf chain naming each definition twice
// and ending in a self-reference doubled the work per level, and 20 levels
// took 360 ms to build a validator's defaults pass, with no option set.

const assert = require('assert')
const defaults = require('../lib/defaults.js')
const { preprocessSource } = require('../lib/codegen-engine.js')

function chain (levels, withDefault) {
  const n0 = { allOf: [{ $ref: '#/$defs/n0' }], type: 'object' }
  if (withDefault) n0.properties = { a: { default: 1 } }
  const defs = { n0 }
  for (let i = 1; i < levels; i++) defs['n' + i] = { allOf: [{ $ref: '#/$defs/n' + (i - 1) }, { $ref: '#/$defs/n' + (i - 1) }] }
  return { $defs: defs, $ref: '#/$defs/n' + (levels - 1) }
}

for (const withDefault of [false, true]) {
  const s = chain(60, withDefault)
  let t = Date.now()
  const src = preprocessSource(s, {})
  assert.ok(Date.now() - t < 2000, 'the generated pass decides quickly')
  // A self-reference is a cycle, which the generated pass declines; the
  // closure pass below takes the schema.
  assert.strictEqual(src, null)
  t = Date.now()
  const fill = defaults.buildDefaultsApplier(s)
  assert.ok(Date.now() - t < 2000, 'the closure pass builds quickly')
  if (withDefault) {
    const o = {}
    fill(o)
    assert.deepStrictEqual(o, { a: 1 }, 'the default behind the chain is filled')
  } else {
    assert.strictEqual(fill, null, 'no pass without a default')
  }
}

// A schema asked about that the root does not reach is answered too.
{
  const root = { properties: { a: { type: 'string' } } }
  const memo = new Map()
  assert.strictEqual(defaults.reachesDefault(root, root, memo, null, null), 0)
  const outside = { properties: { b: { default: 2 } } }
  assert.strictEqual(defaults.reachesDefault(outside, root, memo, null, null), 1)
  assert.strictEqual(defaults.reachesDefault(root, root, memo, null, null), 0)
}

console.log('ok: default reachability is linear in the schema on both passes')
