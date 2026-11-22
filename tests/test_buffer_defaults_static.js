'use strict'

// A validator with defaults answers its buffer APIs on the native walker,
// which reads the bytes without the defaults, only when filling them cannot
// change any answer (lib/defaults-safety.js); otherwise through validate().
// Routing every validator with defaults made isValid(buffer) about 3.6 times
// slower on such a schema. Here every shape where a default changes an answer
// must take validate() and give its answer on every buffer API, and the
// shapes where none can keep the walker.

const assert = require('assert')
const { Validator } = require('..')
const { defaultsCannotChangeVerdict } = require('../lib/defaults-safety.js')

const changes = [
  { type: 'object', properties: { a: { type: 'integer', default: 1 } }, required: ['a'] },
  { type: 'object', properties: { a: { type: 'boolean', default: 'false' } } },
  { type: 'object', properties: { a: { default: 1 }, b: {} }, maxProperties: 1 },
  { type: 'object', properties: { a: { default: 1 } }, minProperties: 1 },
  { allOf: [{ properties: { a: { default: 1 } } }, { properties: { b: {} }, additionalProperties: false }] },
  { properties: { a: { default: 1 } }, anyOf: [{ required: ['b'] }, { not: { required: ['a'] } }] },
  { properties: { a: { default: 1 } }, oneOf: [{ required: ['a'] }, { required: ['b'] }] },
  { properties: { a: { default: 1 } }, not: { required: ['a'] } },
  { properties: { a: { default: 1 } }, if: { required: ['a'] }, then: { required: ['z'] } },
  { type: 'object', properties: { o: { type: 'object', properties: { a: { default: 1 } } } }, enum: [{ o: {} }] },
  { type: 'array', uniqueItems: true, items: { type: 'object', properties: { a: { default: 1 } } } },
  { $defs: { d: { type: 'object', properties: { a: { $ref: '#/$defs/i', default: 'x' } } }, i: { type: 'integer' } }, $ref: '#/$defs/d' },
  { type: 'array', items: { type: 'object', properties: { a: { type: 'string', default: 5 } } } },
  { type: 'object', properties: { o: { type: 'object', default: {}, properties: { n: { type: 'string', default: 1 } } } } },
  { type: 'object', properties: { l: { type: 'array', default: [1], items: { type: 'string' } } } },
  { allOf: [{ properties: { a: { default: 'x' } } }, { properties: { a: { type: 'integer' } } }] },
  { allOf: [{ properties: { a: { default: 'x' } } }, { additionalProperties: { type: 'integer' } }] },
  { type: 'object', properties: { o: { type: 'object', properties: { a: { default: 1 } }, required: ['a'] } } },
  { allOf: [{ properties: { o: { properties: { a: { default: 1 } } } } }, { properties: { o: { maxProperties: 0 } } }] },
  { type: 'object', properties: { a: { default: 1 } }, const: {} },
]
const keeps = [
  { type: 'object', properties: { a: { type: 'integer', default: 1 }, b: { type: 'string' } } },
  { type: 'object', properties: { t: { type: 'array', uniqueItems: true, items: { type: 'string' } }, a: { type: 'integer', default: 1 } } },
  { type: 'object', properties: { o: { type: 'object', default: { x: 1 }, properties: { x: { type: 'integer' } } } } },
  { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, tag: { type: 'string', default: 'x' } }, required: ['id'] } },
  { allOf: [{ properties: { a: { type: 'integer', default: 2 } } }, { properties: { a: { minimum: 1 } } }] },
]
const texts = ['{}', '{"a":1}', '{"b":1}', '{"o":{}}', '[{}]', '[{},{}]', '[{"id":1}]', '{"t":["x"]}', '{"l":[]}', '{"o":{"n":"s"}}']

const prep = (s) => { const v = new Validator(s, {}); v.isValidObject({}); return v }
for (const s of changes) assert.strictEqual(defaultsCannotChangeVerdict(prep(s)._schemaObj, prep(s)._schemaMap, Validator), false, `can change: ${JSON.stringify(s)}`)
for (const s of keeps) assert.strictEqual(defaultsCannotChangeVerdict(prep(s)._schemaObj, prep(s)._schemaMap, Validator), true, `cannot change: ${JSON.stringify(s)}`)

let checked = 0
for (const s of changes.concat(keeps)) {
  for (const t of texts) {
    const want = new Validator(s, {}).validate(JSON.parse(t)).valid
    const v = new Validator(s, {})
    const where = `${JSON.stringify(s)} on ${t}`
    assert.strictEqual(v.isValid(Buffer.from(t)), want, `isValid ${where}`)
    assert.strictEqual(v.countValid(Buffer.from(t + '\n' + t)), want ? 2 : 0, `countValid ${where}`)
    assert.strictEqual(v.batchIsValid([Buffer.from(t)]), want ? 1 : 0, `batchIsValid ${where}`)
    assert.deepStrictEqual(v.isValidParallel(Buffer.from(Array(32).fill(t).join('\n'))), Array(32).fill(want), `isValidParallel ${where}`)
    checked += 4
  }
}
console.log(`ok: defaults that can change a verdict keep the buffer APIs on validate(), the rest on the walker (${changes.length} and ${keeps.length} shapes, ${checked} answers)`)
