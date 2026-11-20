'use strict'

// Deep equality (enum, const, uniqueItems) compares the enumerable own keys of
// both sides, whatever the argument order. The interpreted engines called it
// as (schema, instance) and generated code as (instance, schema), and the
// second argument was probed with hasOwnProperty, which also answers for a
// non-enumerable property: `const: {x: 1}` against `{y: 2}` with a hidden `x`
// was true on one side and false on the other, and uniqueItems depended on
// the items' order.

const assert = require('assert')
const path = require('path')
const Module = require('module')
const { Validator } = require('..')
const aot = require('../lib/aot-impl')
const { _deq } = require('../lib/unique-items')

const ROOT = path.join(__dirname, '..')
const loadCjs = (src) => { const m = new Module('t'); m.filename = path.join(ROOT, 't-module.cjs'); m.paths = Module._nodeModulePaths(ROOT); m._compile(src, m.filename); return m.exports }
const H = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, writable: true, configurable: true })

// The function itself, both orders.
const pairs = [
  [{ x: 1 }, () => H({ y: 2 }, 'x', 1), false],
  [{ x: 1 }, () => H({}, 'x', 1), false],
  [{}, () => H({}, 'x', 1), true],
  [{ x: 1, y: 2 }, () => H({ y: 2, z: 3 }, 'x', 1), false],
  [{ y: 2, x: 1 }, () => ({ x: 1, y: 2 }), true],
  [{ o: { a: 1 } }, () => ({ o: H({ a: 1 }, 'b', 2) }), true],
]
for (const [a, mk, want] of pairs) {
  assert.strictEqual(_deq(a, mk()), want, `_deq(${JSON.stringify(a)}, b)`)
  assert.strictEqual(_deq(mk(), a), want, `_deq(b, ${JSON.stringify(a)})`)
}

const cases = [
  [{ const: { x: 1 } }, () => H({ y: 2 }, 'x', 1), false],
  [{ const: { x: 1 } }, () => H({}, 'x', 1), false],
  [{ const: {} }, () => H({}, 'x', 1), true],
  [{ enum: [{ x: 1 }] }, () => H({}, 'x', 1), false],
  [{ enum: [{ x: 1 }, 'a'] }, () => H({ y: 2 }, 'x', 1), false],
  [{ uniqueItems: true }, () => [{}, H({}, 'x', 1)], false],
  [{ uniqueItems: true }, () => [{ x: 1, y: 2 }, H({ y: 2, z: 3 }, 'x', 1)], true],
  [{ uniqueItems: true }, () => [H({ y: 2, z: 3 }, 'x', 1), { x: 1, y: 2 }], true],
  [{ uniqueItems: true }, () => Array.from({ length: 14 }, (_, i) => (i === 13 ? H({}, 'a', 0) : { a: i })), true],
]
const paths = {
  'interpreted engine': (s) => { const v = new Validator(s, { engine: 'interpreter' }); return (d) => [v.isValidObject(d()), v.validate(d()).valid] },
  'closure tree': (s) => { const v = new Validator(s, { engine: 'interpreter' }); for (let i = 0; i < 1100; i++) v.isValidObject(i % 2 ? {} : []); return (d) => [v.isValidObject(d()), v.validate(d()).valid] },
  'generated code, calls 1, 3 and 100': (s) => (d) => { const v = new Validator(s); const r = []; for (let i = 1; i <= 100; i++) { const x = v.isValidObject(d()); if (i === 1 || i === 3 || i === 100) r.push(x) } r.push(v.validate(d()).valid); return r },
  module: (s) => { const src = aot.toStandaloneModule(new Validator(s), { format: 'cjs', order: true, onWarning () {} }); if (!src) return null; const m = loadCjs(src); return (d) => [m.isValid(d()), m.validate(d()).valid] },
}
let n = 0
;(async () => {
  for (const [schema, doc, want] of cases) {
    for (const [pn, build] of Object.entries(paths)) {
      const ask = build(structuredClone(schema))
      if (ask === null) continue
      for (const got of ask(doc)) assert.strictEqual(got, want, `${pn} | ${JSON.stringify(schema)}`)
      n++
    }
  }
  console.log(`ok: deep equality reads enumerable own keys on both sides, ${n} path cases`)
})().catch((e) => { console.error(e); process.exit(1) })
