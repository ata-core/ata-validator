'use strict'

// A rejection shows its verdict and its errors, not what it holds to build
// them. The document, the JSON text, the validator and the builders sat on
// enumerable own fields, so Object.keys, a spread and console.log of a failed
// result showed the whole input (structuredClone threw on the functions among
// them). JSON.stringify was already clean through toJSON. The marker below
// sits in a valid part of the document, so errors never carry it; a
// validateJSON error's dataFrame is the documented exception, the source line
// it points at, and is left out of the JSON check for that path.

const assert = require('assert')
const util = require('util')
const { Validator } = require('..')

const MARK = 'MARKER_7f3a'
const schema = { type: 'object', properties: { a: { type: 'integer' }, note: { type: 'string' } }, required: ['a'] }
const doc = () => ({ a: 'x', note: MARK })
const big = () => ({ a: 'x', note: MARK, pad: 'p'.repeat(9000) })
const hot = (o) => { const v = new Validator(schema, o); for (let i = 0; i < 80; i++) v.validate({ a: 1 }); return v }

const ways = {
  'validate': () => new Validator(schema).validate(doc()),
  'validate, after 80 calls': () => hot().validate(doc()),
  'validate, interpreter': () => new Validator(schema, { engine: 'interpreter' }).validate(doc()),
  'validate, richErrors false': () => new Validator(schema, { richErrors: false }).validate(doc()),
  'validate, verbose': () => new Validator(schema, { verbose: true }).validate(doc()),
  'validate, coerceTypes': () => new Validator(schema, { coerceTypes: true }).validate(doc()),
  'validateJSON': () => new Validator(schema).validateJSON(JSON.stringify(doc())),
  'validateJSON, 9 KB': () => new Validator(schema).validateJSON(JSON.stringify(big())),
  'validateJSON, richErrors false': () => new Validator(schema, { richErrors: false }).validateJSON(JSON.stringify(doc())),
  'validateJSON, 9 KB, richErrors false': () => new Validator(schema, { richErrors: false }).validateJSON(JSON.stringify(big())),
}

for (const [name, get] of Object.entries(ways)) {
  const r = get()
  assert.strictEqual(r.valid, false, name)
  assert.deepStrictEqual(Object.keys(r), ['valid'], `${name}: own keys`)
  assert.ok(!util.inspect({ ...r }, { depth: 8 }).includes(MARK), `${name}: a spread does not carry the document`)
  assert.ok(!util.inspect(r, { depth: 8 }).includes(MARK), `${name}: console.log does not show the document`)
  const c = structuredClone(r)
  assert.ok(!util.inspect(c, { depth: 8 }).includes(MARK), `${name}: structuredClone does not copy the document`)
  // errors still read, serialize and enumerate as before
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0, `${name}: errors read`)
  const json = JSON.parse(JSON.stringify(r))
  assert.deepStrictEqual(Object.keys(json).sort(), ['errors', 'valid'], `${name}: JSON shape`)
  if (!name.startsWith('validateJSON') || name.includes('richErrors false')) {
    assert.ok(!JSON.stringify(r).includes(MARK), `${name}: JSON does not carry the document`)
  }
  const inherited = []
  for (const k in r) inherited.push(k)
  assert.ok(inherited.includes('errors') || name.includes('9 KB, richErrors false'), `${name}: for-in still names errors`)
}

console.log(`ok: ${Object.keys(ways).length} rejection paths show only valid and errors, never the document`)
