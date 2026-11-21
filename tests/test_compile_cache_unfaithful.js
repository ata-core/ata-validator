'use strict'

// Validators share compiled code through a cache keyed by the schema's
// JSON.stringify text. A schema JSON cannot carry (NaN, Infinity, undefined in
// an array, a hole, a function) is written with null in that place, while the
// engines that read the schema object read the value. The first such schema
// compiled filled the cache for the JSON-equal one: after
// `{ not: { const: NaN }, dependentRequired: { zzz: [] } }`,
// `{ not: { const: null }, dependentRequired: { zzz: [] } }` accepted null in
// isValidObject() (and its validate() said false). A schema whose text is not
// faithful now has a key of its own; a faithful one is keyed as before.

const assert = require('assert')
const { Validator } = require('..')
const core = require('../lib/validator-core.js')._internals

const DECLINE = { dependentRequired: { zzz: [] } }
const pairs = [
  [{ not: { const: NaN }, ...DECLINE }, { not: { const: null }, ...DECLINE }, null],
  [{ enum: [Infinity, 'x'], ...DECLINE }, { enum: [null, 'x'], ...DECLINE }, null],
  [{ const: [1, , 2], ...DECLINE }, { const: [1, null, 2], ...DECLINE }, [1, null, 2]],
  [{ enum: [undefined], ...DECLINE }, { enum: [null], ...DECLINE }, null],
  [{ not: { const: NaN } }, { not: { const: null } }, null],
  [{ enum: [-Infinity] }, { enum: [null] }, null],
]
let checked = 0
for (const [odd, plain, doc] of pairs) {
  // The odd schema first, so a shared entry would answer the plain one.
  new Validator(odd).isValidObject(doc)
  new Validator(odd).validate(doc)
  const v = new Validator(plain)
  const want = new Validator(plain, { engine: 'interpreter' }).validate(doc).valid
  assert.strictEqual(v.isValidObject(doc), want, `isValidObject after ${JSON.stringify(odd)}`)
  assert.strictEqual(v.validate(doc).valid, want, `validate after ${JSON.stringify(odd)}`)
  checked += 2
}

// The key: a faithful schema's is its text, as before; an unfaithful one's is
// one no other schema has.
const text = JSON.stringify({ const: null })
assert.strictEqual(core.compileCacheKey(text, new Map(), { const: null }), text)
const k1 = core.compileCacheKey(text, new Map(), { const: NaN })
assert.notStrictEqual(k1, text)
assert.notStrictEqual(core.compileCacheKey(text, new Map(), { const: NaN }), k1)
// A registered document is held to the same rule.
const t2 = JSON.stringify({ $ref: 'urn:x' })
assert.notStrictEqual(core.compileCacheKey(t2, new Map([['urn:x', { const: NaN }]]), { $ref: 'urn:x' }), core.compileCacheKey(t2, new Map([['urn:x', { const: null }]]), { $ref: 'urn:x' }))

console.log(`ok: a schema JSON cannot carry never shares compiled code with the one its text spells (${checked} answers)`)
