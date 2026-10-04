'use strict'

// Object keys whose declared names average ten characters or more are found
// with indexOf in the text scanner, not by the character loop, and a name it
// does not recognise is checked for an escape or a control character before
// it is read as additional. The fuzzed differential uses short names and never
// reaches that path, so this drives it directly: keys with an escaped quote,
// a declared name spelled with a \u escape, a raw control character, unknown
// long keys, and duplicates, each compared with validate() on the parsed text.

const assert = require('node:assert')
const { compileScanner } = require('../lib/scan-compiler')
const { Validator } = require('..')

const schemas = [
  { type: 'object', properties: { 'adjoining-classes': { enum: [2, true, false] }, 'compatible-vendor-prefixes': { type: 'string' } } },
  { type: 'object', properties: { 'adjoining-classes': { enum: [2, true, false] }, 'compatible-vendor-prefixes': { type: 'string' } }, additionalProperties: false },
  { type: 'object', properties: { 'adjoining-classes': { enum: [2, true, false] } }, additionalProperties: { type: 'integer' } },
  { type: 'object', properties: { 'adjoining-classes': { type: 'boolean' }, 'compatible-vendor-prefixes': { type: 'string' } }, required: ['adjoining-classes'] },
]
const texts = [
  '{}',
  '{"adjoining-classes":2}',
  '{"adjoining-classes":3}',
  '{"adjoining-classes":true,"compatible-vendor-prefixes":"x"}',
  '{"compatible-vendor-prefixes":5}',
  '{"adjoining\\u002dclasses":3}',
  '{"adjoining\\u002dclasses":true}',
  '{"adjoining-classe\\"s":3}',
  '{"adjoining-classes\\\\":3}',
  '{"q\\"q":1,"adjoining-classes":2}',
  '{"some-unknown-long-key":1}',
  '{"some-unknown-long-key":"x"}',
  '{"some-unknown-\\"long-key":1}',
  '{"adjoining-classes":3,"adjoining-classes":2}',
  '{"adjoining-classes":2,"adjoining-classes":3}',
  '{"adjoining-classes":2,"adjoining\\u002dclasses":3}',
  '{"adjoining\u0001classes":2}',
  '{"adjoining-classes":2',
  '{"adjoining-classes:2}',
  '{"adjoining-classes',
]

let compared = 0
for (const schema of schemas) {
  const v = new Validator(schema)
  const built = compileScanner(v._schemaObj)
  assert.ok(built, 'expected a scanner for ' + JSON.stringify(schema))
  assert.ok(built.functions.some((f) => f.includes("indexOf('\"'")), 'expected the indexOf key path for ' + JSON.stringify(schema))
  for (const text of texts) {
    let want
    try { want = v.validate(JSON.parse(text)).valid } catch { want = false }
    const r = built.scan(text)
    if (r !== -1) assert.strictEqual(r === 1, want, `scanner on ${text} for ${JSON.stringify(schema)}`)
    assert.strictEqual(v.isValidJSON(text), want, `isValidJSON on ${text}`)
    compared++
  }
}
console.log(`ok: the indexOf key path answers as validate() does (${compared} comparisons, escaped and duplicate keys included)`)
