'use strict'

// Property names holding control characters, the two line separators, quotes
// and a literal backslash-u sequence. Written raw into a single-quoted path
// literal, a newline in a name broke the combined function's source, it
// failed to compile, and every schema with such a name lost one-pass
// validation and validated twice per read error. The combined function must
// compile, and every read must name the same paths as the interpreter.

const assert = require('node:assert')
const { Validator } = require('..')
const { compileToJSCombined } = require('../lib/js-compiler')

const names = ['foo\nbar', 'foo bar', 'a\tb', "it's", 'q"q', 'a\\u0041', 'a/b~c', 'x\u0001y']
const properties = {}
for (const n of names) properties[n] = { type: 'number', minimum: 1 }
const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties, required: names.slice(0, 3) }
const docs = [Object.fromEntries(names.map((n) => [n, 'x'])), Object.fromEntries(names.map((n) => [n, 0])), {}, Object.fromEntries(names.map((n) => [n, 5]))]

const v = new Validator(schema)
assert.strictEqual(typeof compileToJSCombined(v._schemaObj, { valid: true, errors: [] }, null, null, { runtimeShape: true }), 'function', 'the combined function compiles')
const shape = (r) => JSON.stringify((r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.params]))
let compared = 0
for (const richErrors of [false, true]) {
  const a = new Validator(schema, { richErrors })
  const b = new Validator(schema, { richErrors, engine: 'interpreter' })
  for (const d of docs) {
    for (let r = 0; r < 80; r++) { const x = a.validate(d); if (!x.valid) void x.errors }
    const ra = a.validate(d), rb = b.validate(d)
    assert.strictEqual(ra.valid, rb.valid)
    assert.strictEqual(shape(ra), shape(rb), `richErrors ${richErrors}`)
    compared++
  }
}
console.log(`ok: escaped property names compile into the combined function and report the interpreter's paths (${compared} documents)`)
