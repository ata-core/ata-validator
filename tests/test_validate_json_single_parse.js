'use strict'

// validateJSON() hands the document it parsed to its rejection, so reading the
// errors does not parse the text again. The errors must still be what
// validate() gives for the parsed document, defaults written in included,
// on generated code and on the interpreted engine.

const assert = require('node:assert')
const { Validator } = require('..')

const schema = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 3 }, role: { type: 'string', default: 'user', enum: ['admin', 'user'] }, tags: { type: 'array', items: { type: 'string' } } },
  required: ['name', 'email'],
}
const texts = ['{"name":"x","tags":[1]}', '{"nmae":"abcd","email":"e"}', '{"name":"abcd","email":"e","role":"root"}']
const shape = (errs) => JSON.stringify(errs.map((e) => [e.keyword, e.instancePath, e.received, e.suggestion && e.suggestion.text]))
for (const engine of ['auto', 'interpreter']) {
  const v = new Validator(schema, { engine })
  for (const t of texts) {
    for (let i = 0; i < 80; i++) { const r = v.validateJSON(t); if (!r.valid) void r.errors }
    const expected = v.validate(JSON.parse(t))
    const realParse = JSON.parse
    let parses = 0
    JSON.parse = function (...a) { parses++; return realParse.apply(this, a) }
    let r
    try {
      r = v.validateJSON(t)
      assert.strictEqual(r.valid, expected.valid)
      void r.errors
    } finally {
      JSON.parse = realParse
    }
    assert.strictEqual(parses, 1, `${engine}: the text is parsed once, errors read included, for ${t}`)
    assert.strictEqual(shape(r.errors), shape(expected.errors), `${engine}: same errors as validate() for ${t}`)
  }
}
console.log('ok: validateJSON reads its errors from the document it parsed, once, with the same errors as validate()')
