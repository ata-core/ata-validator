'use strict'

// JSON text that names a member twice, and text holding a surrogate escape
// outside a pair. JSON.parse keeps the last value of a repeated name and reads
// "\ud800" as a one-unit string; validate() judges what it returns. The
// native walkers read every value of a repeated name and counted every one,
// and simdjson refuses the lone surrogate, so the buffer APIs and the text
// path past the simdjson threshold answered otherwise: [{"a":1},{"a":2,"a":1}]
// passed uniqueItems, {"a":1,"a":2} passed minProperties: 2, and
// {"a":1,"a":"x"} passed { not: { properties: { a: { type: "integer" } } } },
// each rejected by validate(); {"a":"x","a":1} and "\ud800" were rejected
// against schemas validate() says they meet. The walkers now leave such a
// document to the JS path (null from the addon), and only such a document.
//
// Every buffer API and the text path past 8 KB are held to validate() on
// JSON.parse of the same text, with the addon loaded and without it.

const assert = require('assert')
const { Validator } = require('..')

const schemas = [
  { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'string' } }, required: ['a'] },
  { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'string' } }, additionalProperties: false },
  { type: 'object', properties: { o: { type: 'object', properties: { a: { type: 'integer', minimum: 1 } } }, z: { type: 'string' } } },
  { type: 'array', items: { type: 'object', properties: { a: { type: 'integer' } } } },
  { type: 'object', minProperties: 2 },
  { type: 'object', maxProperties: 1 },
  { type: 'object', properties: { a: {} }, minProperties: 2 },
  { const: { a: 1 } },
  { enum: [{ a: 1 }, 'x'] },
  { not: { const: { a: 1 } } },
  { type: 'array', uniqueItems: true },
  { not: { properties: { a: { type: 'integer' } } } },
  { oneOf: [{ properties: { a: { type: 'integer' } } }, { properties: { a: { type: 'string' } } }] },
  { if: { properties: { a: { type: 'integer' } } }, then: { required: ['z'] } },
  { type: 'object', additionalProperties: { type: 'integer' } },
  { allOf: [{ properties: { a: { type: 'integer' } } }, { required: ['a'] }] },
  { type: 'object', properties: { s: { type: 'string', maxLength: 1 } } },
  { type: 'string', maxLength: 1 },
]
const texts = [
  '{"a":"x","a":1}', '{"a":1,"a":"x"}', '{"a":1,"a":1}', '{"a":1,"b":"s","a":2}', '{"a":1,"\\u0061":"x"}', '{"\\u0061":"x","a":1}',
  '{"a":1,"a":2}', '{"a":2,"a":1}', '{"x":1,"x":2}', '{"x":"s","x":1}', '{"o":{"a":0,"a":5},"z":"s"}', '{"o":{"a":5,"a":0},"z":"s"}',
  '[{"a":"x","a":1}]', '[{"a":1,"a":"x"}]', '[{"a":1},{"a":2,"a":1}]', '[{"a":1},{"a":1,"a":2}]',
  '{"s":"\\ud800"}', '{"s":"\\ud800b"}', '"\\ud800"', '"\\udc00"', '{"a":1}', '{"a":1,"b":"s"}', '[{"a":1},{"a":2}]',
]
// The same documents past the 32 bytes the on-demand walker wants.
const padded = texts.filter((t) => t.startsWith('{')).map((t) => '{"zzpad":"' + 'p'.repeat(40) + '",' + t.slice(1))

let checked = 0
for (const schema of schemas) {
  const v = new Validator(schema, {})
  for (const t of texts.concat(padded)) {
    const want = new Validator(schema, { engine: 'interpreter' }).validate(JSON.parse(t)).valid
    const where = `${JSON.stringify(schema)} on ${t}`
    const many = Buffer.from(Array(64).fill(t).join('\n'))
    const pad = Buffer.alloc(Buffer.byteLength(t) + 64); pad.write(t)
    const got = {
      'isValid(buffer)': v.isValid(Buffer.from(t)),
      isValidPrepadded: v.isValidPrepadded(pad, Buffer.byteLength(t)),
      batchIsValid: v.batchIsValid([Buffer.from(t)]) === 1,
      isValidNDJSON: v.isValidNDJSON(Buffer.from(t))[0],
      'isValidParallel, 64 lines': v.isValidParallel(many).every((x) => x === want) ? want : !want,
      'countValid, 64 lines': v.countValid(many) === (want ? 64 : 0) ? want : !want,
      'isValidJSON past 8 KB': v.isValidJSON(t + ' '.repeat(9000)),
      'validateJSON past 8 KB': v.validateJSON(t + ' '.repeat(9000)).valid,
      validateAndParse: v.validateAndParse(t).valid,
    }
    for (const [reader, g] of Object.entries(got)) { assert.strictEqual(g, want, `${reader}: ${where}`); checked++ }
  }
}

// What the addon answers itself stays answered by it: an ordinary document
// gives a boolean, and so does a repeated name whose last value decides (the
// one JSON.parse keeps). A failed value with a later one of its name gives
// null for the JS path to answer, and so does a lone surrogate escape.
const native = require('../lib/native-load')()
if (native) {
  const slot = native.fastRegister(JSON.stringify({ type: 'object', properties: { a: { type: 'integer' } } }))
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from('{"a":1}')), true)
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from('{"a":"x"}')), false)
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from('{"a":"x","a":1}')), null)
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from('{"a":1,"a":"x"}')), false)
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from('{"a":1,"a":2}')), true)
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from('{"a":"\\ud800"}')), null)
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from('{"a":1,"b":2,"b":3}')), true)
}

console.log(`ok: repeated names and lone surrogate escapes answer as validate() on every buffer API (${checked} answers, native engine ${native ? 'loaded' : 'not loaded'})`)
