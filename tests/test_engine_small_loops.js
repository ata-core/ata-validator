'use strict'

// The small engine's item loop (lib/engine-small.js, the array step): where
// `items` is a node that checks only its type, a verdict reads each item's
// type bits in one loop instead of calling the node per item. That loop must
// answer as the node does on every item, so every type mask is checked here
// against the interpreter's walk on arrays of every JSON type and the values
// where a type test can slip: holes, NaN, the infinities, -0, the edges of
// int32 and of safe integers. The shapes where the loop must not be taken
// (prefixItems, an annotation reader, a node with more than its type, a node
// reached again by recursion or shared) are checked the same way, as are the
// generated copy (lib/engine-full.js) and both 2.0 entries.

const assert = require('node:assert')
const { createInterpreter } = require('../lib/interpreter-core.js')
const small = require('../lib/engine-small.js').createSmall
const full = require('../lib/engine-full.js').createSmall
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)
const { Validator: Full } = require('../lib/validator-full.js')

const holey = (n, fill) => { const a = new Array(n); for (const [i, v] of fill) a[i] = v; return a }
const values = [
  'x', '', 0, -0, 1, -1, 1.5, -1.5, NaN, Infinity, -Infinity,
  2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53, Number.MAX_VALUE, Number.MIN_VALUE, 1e-9,
  true, false, null, {}, { a: 1 }, [], [1], undefined,
]
const arrays = [[], [new Array(1)], [holey(3, [[0, 1], [2, 2]])], [holey(3, [[0, 'a'], [2, 'b']])]]
for (const v of values) { arrays.push([v]); arrays.push([v, v]); arrays.push([1, v]); arrays.push(['a', v]); arrays.push([v, 1.5]) }
arrays.push(values)
const docs = [...arrays.map((a) => a[0]), 'not an array', 1, null, {}]

const types = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array', 'notAType', 'toString', '__proto__']
const masks = [...types.map((t) => t), ...types.map((t) => [t]), [], ['string', 'null'], ['integer', 'string'], ['number', 'integer'], ['boolean', 'array', 'object'], ['null', 'notAType']]

let checked = 0
function same (schema, label) {
  const walk = createInterpreter(schema, { tier: Infinity })
  const engines = [['small', small(schema, {})], ['full', full(schema, {})]]
  const entry = new Full(schema, { useDefaults: false })
  for (const d of docs) {
    const want = walk.validate(d)
    const where = `${label}: ${String(Array.isArray(d) ? '[' + d.map(String) + ']' : d)}`
    for (const [name, e] of engines) {
      assert.strictEqual(e.isValid(d), want.valid, `${where}: ${name} isValid`)
      assert.strictEqual(JSON.stringify(e.validate(d)), JSON.stringify(want), `${where}: ${name} validate`)
    }
    assert.strictEqual(entry.isValidObject(d), want.valid, `${where}: browser entry`)
    checked++
  }
}

for (const t of masks) {
  const name = JSON.stringify(t)
  same({ items: { type: t } }, `items ${name}`)
  same({ type: 'array', items: { type: t } }, `array items ${name}`)
  // Not the loop: the item node checks more than its type.
  same({ items: { type: t, minimum: 0 } }, `items ${name} minimum`)
  same({ items: { type: t, maxLength: 0 } }, `items ${name} maxLength`)
  // Not the loop: prefixItems before it.
  same({ prefixItems: [{ type: 'string' }], items: { type: t } }, `prefixItems, items ${name}`)
  // Not the loop: unevaluatedItems reads which items were evaluated.
  same({ items: { type: t }, unevaluatedItems: false }, `items ${name}, unevaluatedItems`)
  same({ allOf: [{ items: { type: t } }], unevaluatedItems: false }, `allOf items ${name}, unevaluatedItems`)
  // Nested: the loop inside an item node.
  same({ items: { items: { type: t } } }, `nested items ${name}`)
}

// One item node shared by two parents and by a property: the loop is taken
// only where the mask is the node's own.
const shared = { type: 'number' }
same({ properties: { a: shared }, items: shared }, 'shared item node')
same({ items: { $ref: '#/$defs/n' }, $defs: { n: { type: 'integer' } } }, 'item node behind $ref')
same({ $defs: { n: { type: 'string' } }, properties: { a: { $ref: '#/$defs/n' } }, items: { type: 'integer' } }, 'a type node built before the items node')
// A node reached again while it is built.
same({ $id: 'https://x.test/r', type: ['array', 'number'], items: { $ref: '#' } }, 'recursive items')
same({ items: { $dynamicRef: '#t' }, $defs: { t: { $dynamicAnchor: 't', type: 'boolean' } } }, 'items by $dynamicRef')
// Boolean and empty item schemas.
same({ items: true }, 'items true')
same({ items: false }, 'items false')
same({ items: {} }, 'items {}')

// Every item checked, not only the first or last that differs.
for (const t of ['string', 'number', 'integer']) {
  const v = small({ items: { type: t } }, {})
  const good = t === 'string' ? 'a' : 1
  for (let at = 0; at < 40; at++) {
    const a = new Array(40).fill(good); a[at] = t === 'string' ? 1 : 'a'
    assert.strictEqual(v.isValid(a), false, `${t}: bad item at ${at}`)
    const h = new Array(40).fill(good); delete h[at]
    assert.strictEqual(v.isValid(h), false, `${t}: hole at ${at}`)
  }
}

console.log(`engine-small item loops: ${checked} documents, small, full and the browser entry agree with the interpreter`)
