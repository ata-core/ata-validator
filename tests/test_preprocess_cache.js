'use strict'

// Validators with the same schema and the same rewriting options share one
// generated preprocess pass, as they share the verdict function, and passes
// with the same generated source share one compiled function. A Fastify
// app repeats a body schema across routes, and each route generated and
// compiled the pass again. Sharing must never cross options or referenced
// schemas: a pass built for coercion must not coerce for a validator that
// did not ask, and a pass built against one `shared` schema must not fill
// defaults from another.

const assert = require('assert')
const { Validator } = require('..')

const schema = { type: 'object', properties: { a: { type: 'integer', default: 1 }, b: { type: 'object', properties: { c: { type: 'string' } } } } }
const run = (opts, doc, extra) => { const v = new Validator(schema, { ...opts, ...extra }); v.validate(doc); return { v, doc } }

const a = run({ coerceTypes: true }, { b: { c: 5 } })
const b = run({ coerceTypes: true }, {})
assert.strictEqual(a.v._applyDefaults, b.v._applyDefaults, 'same schema and options share the pass')
assert.deepStrictEqual(a.doc, { b: { c: '5' }, a: 1 })

const plain = run({}, { b: { c: 5 } })
assert.notStrictEqual(plain.v._applyDefaults, a.v._applyDefaults)
assert.deepStrictEqual(plain.doc, { b: { c: 5 }, a: 1 }, 'no coercion without coerceTypes')

const noDefaults = run({ coerceTypes: true, useDefaults: false }, { b: { c: 5 } })
assert.deepStrictEqual(noDefaults.doc, { b: { c: '5' } }, 'no defaults with useDefaults: false')

// Passes are also kept by their generated source, so options that emit the
// same source share a function; where the source differs, so does the pass.
const tagged = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } }
const wrap = {}; new Validator(tagged, { coerceTypes: 'array' }).validate(Object.assign(wrap, { tags: 'x' }))
const keep = {}; new Validator(tagged, { coerceTypes: true }).validate(Object.assign(keep, { tags: 'x' }))
assert.deepStrictEqual([wrap, keep], [{ tags: ['x'] }, { tags: 'x' }], "coerceTypes: 'array' wraps, true does not")

// Schemas that differ only in constraints share the compiled pass, and each
// still checks its own constraints.
const lo = new Validator({ type: 'object', properties: { v: { type: 'integer', minimum: 1 } } }, { coerceTypes: true })
const hi = new Validator({ type: 'object', properties: { v: { type: 'integer', minimum: 5 } } }, { coerceTypes: true })
const dl = { v: '3' }, dh = { v: '3' }
assert.deepStrictEqual([lo.validate(dl).valid, hi.validate(dh).valid, dl, dh], [true, false, { v: 3 }, { v: 3 }])
assert.strictEqual(lo._applyDefaults, hi._applyDefaults, 'the same shape compiles once')

// The same root text, referencing schemas that differ.
const ref = { $ref: 'shared#' }
const s1 = { $id: 'shared', type: 'object', properties: { n: { type: 'integer', default: 1 } } }
const s2 = { $id: 'shared', type: 'object', properties: { n: { type: 'integer', default: 2 } } }
const d1 = {}; new Validator(ref, { schemas: [s1] }).validate(d1)
const d2 = {}; new Validator(ref, { schemas: [s2] }).validate(d2)
assert.deepStrictEqual([d1, d2], [{ n: 1 }, { n: 2 }], 'referenced schemas are part of the key')

console.log('ok: the generated preprocess pass is shared only where schema, references and options all match')
