'use strict'

// lib/engine-small.js reads a keyword only when the node has it as an own
// property. A keyword the node gets some other way (non-enumerable, from its
// prototype, from a polluted Object.prototype) must still be read, as the
// by-name reads did, or the node would accept everything. These are the
// shapes where that could go wrong, then the whole suite with every schema
// node moved behind a prototype (which takes the by-name reads) against the
// same schema as plain objects (which takes the own-name mask).

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createSmall } = require('../lib/engine-small.js')
// Every schema-decided group (lib/groups.js), as the full 2.0 entries register them.
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)

const verdicts = (schema, data) => { const v = createSmall(schema, {}); return data.map((d) => v.isValid(d)) }
const keywords = (schema, d) => { const r = createSmall(schema, {}).validate(d); return r.valid ? [] : r.errors.map((e) => e.keyword) }

// One node, `type: 'string'` reached in each way: 1 is rejected, 'x' accepted.
const shapes = {
  'non-enumerable own type': () => Object.defineProperty({}, 'type', { value: 'string', enumerable: false }),
  'own getter': () => ({ get type () { return 'string' } }),
  'type on the prototype': () => Object.create({ type: 'string' }),
  'prototype getter': () => Object.create({ get type () { return 'string' } }),
  'class instance, getter': () => new (class { get type () { return 'string' } })(),
  'class instance, own field': () => new (class { constructor () { this.type = 'string' } })(),
  'Object.create(null)': () => Object.assign(Object.create(null), { type: 'string' }),
  'symbol key beside type': () => ({ [Symbol('type')]: 'number', type: 'string' }),
}
for (const [name, make] of Object.entries(shapes)) {
  assert.deepStrictEqual(verdicts(make(), [1, 'x', {}]), [false, true, false], name)
  assert.deepStrictEqual(keywords(make(), 1), ['type'], name + ': errors')
}
// A symbol named like a keyword is not one.
assert.deepStrictEqual(verdicts({ [Symbol.for('type')]: 'string' }, [1, 'x']), [true, true], 'symbol only')

// Mixed trees: the mask is per node.
const inherit = (o) => Object.assign(Object.create({ __marker: true }), o)
assert.deepStrictEqual(verdicts({ properties: { a: Object.create({ type: 'string' }) } }, [{ a: 1 }, { a: 'x' }]), [false, true], 'plain root, inherited child')
assert.deepStrictEqual(verdicts(inherit({ properties: { a: { type: 'string' } } }), [{ a: 1 }, { a: 'x' }]), [false, true], 'inherited root, plain child')
assert.deepStrictEqual(verdicts({ allOf: [Object.defineProperty({}, 'minimum', { value: 5 })] }, [1, 7]), [false, true], 'non-enumerable minimum in allOf')
assert.deepStrictEqual(verdicts({ anyOf: [Object.create({ type: 'string' }), { type: 'null' }] }, [1, 'x', null]), [false, true, true], 'inherited anyOf branch')
assert.deepStrictEqual(verdicts(Object.create({ $ref: '#/$defs/s' }, { $defs: { value: { s: { type: 'string' } }, enumerable: true } }), [1, 'x']), [false, true], 'inherited $ref')

// A keyword on Object.prototype after load: every node reads it.
for (const enumerable of [false, true]) {
  try {
    Object.defineProperty(Object.prototype, 'minimum', { value: 5, enumerable, configurable: true, writable: true })
    assert.deepStrictEqual(verdicts({}, [1, 7]), [false, true], 'polluted Object.prototype, empty schema, enumerable ' + enumerable)
    assert.deepStrictEqual(verdicts({ properties: { a: {} } }, [{ a: 1 }, { a: 7 }]), [false, true], 'polluted Object.prototype, nested, enumerable ' + enumerable)
  } finally { delete Object.prototype.minimum }
}
// Any name added to it sends the nodes to the by-name reads, which then read
// as before.
try {
  Object.defineProperty(Object.prototype, 'unrelated', { value: 1, configurable: true })
  assert.deepStrictEqual(verdicts({ type: 'string' }, [1, 'x']), [false, true], 'other name on Object.prototype')
} finally { delete Object.prototype.unrelated }
assert.deepStrictEqual(verdicts({}, [1]), [true], 'clean again')

// A keyword on Object.prototype before the module loads.
const before = execFileSync(process.execPath, ['-e', `
  Object.defineProperty(Object.prototype, 'type', { value: 'string', configurable: true })
  const { createSmall } = require(${JSON.stringify(path.resolve(__dirname, '../lib/engine-small.js'))})
  require(${JSON.stringify(path.resolve(__dirname, '../lib/validator-small.js'))}).Validator.use(...require(${JSON.stringify(path.resolve(__dirname, '../lib/features/groups.js'))}).all)
  const v = createSmall({}, {}); const w = createSmall({ properties: { a: {} } }, {})
  process.stdout.write(JSON.stringify([v.isValid(1), v.isValid('x'), w.isValid('x'), w.isValid(1)]))
`], { encoding: 'utf8' })
assert.deepStrictEqual(JSON.parse(before), [false, true, true, false], 'keyword on Object.prototype before load')

// The suite: every node behind a prototype against the plain schema. Values
// (const, enum, default, examples) stay plain; equality reads their
// prototypes no more than the plain run does.
const VALUE = new Set(['const', 'enum', 'default', 'examples'])
const P = {}
const reproto = (x) => {
  if (Array.isArray(x)) return x.map(reproto)
  if (x === null || typeof x !== 'object') return x
  const o = Object.create(P)
  for (const k of Object.keys(x)) Object.defineProperty(o, k, { value: VALUE.has(k) ? x[k] : reproto(x[k]), enumerable: true, writable: true, configurable: true })
  return o
}
const run = (schema, opts, data) => {
  let v
  try { v = createSmall(schema, opts) } catch (e) { return 'THROW ' + e.name + ' ' + e.message }
  return data.map((d) => { try { const r = v.validate(d); return JSON.stringify([v.isValid(d), r.valid, r.valid ? 0 : r.errors]) } catch (e) { return 'THROW ' + e.message } })
}
const root = path.join(__dirname, 'suite', 'tests')
let groups = 0; let docs = 0
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!p.endsWith('.json')) continue
    for (const g of JSON.parse(fs.readFileSync(p, 'utf8'))) {
      const data = g.tests.map((t) => t.data)
      for (const opts of [{}, { flat: true, v1: p.includes(path.sep + 'v1' + path.sep) }]) {
        if (opts.flat && typeof g.schema === 'object' && g.schema !== null && /"\$(ref|dynamicRef|id|anchor|dynamicAnchor)"/.test(JSON.stringify(g.schema))) continue
        assert.deepStrictEqual(run(reproto(g.schema), opts, data), run(g.schema, opts, data), p + ': ' + g.description)
      }
      groups++; docs += data.length
    }
  }
}
assert.ok(fs.existsSync(root), 'tests/suite is empty: git submodule update --init tests/suite')
walk(root)
assert.ok(groups > 1000, 'suite groups ' + groups)
console.log(`engine-small mask: ${Object.keys(shapes).length} node shapes, Object.prototype before and after load, ${groups} suite groups (${docs} documents) by name and by mask agree`)
