'use strict'

// A $ref with annotations beside it, `{ $ref, description }` and the like, is
// compiled like a bare $ref: annotations validate nothing. It used to send the
// whole schema to the interpreted engine, which on the 977 SchemaStore schemas
// was 223 of them. A sibling that does validate must still decline, because
// the generators skip the rest of a $ref node. Both halves are checked against
// the interpreted engine: verdicts, errors in full, and which engine answered.

const assert = require('assert')
const { Validator } = require('..')

const ANNOTATIONS = {
  title: 'T', description: 'D', default: 3, examples: [1], $comment: 'c', deprecated: true,
  readOnly: true, writeOnly: false, markdownDescription: '**d**', deprecationMessage: 'm',
  enumDescriptions: ['a'], defaultSnippets: [{ body: 1 }], 'x-vendor': { a: 1 },
}
const VALIDATING = { minimum: 5, type: 'string', maxLength: 1, enum: [1], const: 2, not: {}, format: 'email' }

const target = { type: 'integer', minimum: 1, maximum: 100 }
const docs = [{ n: 0 }, { n: 2 }, { n: 'x' }, { n: 7 }, { n: 200 }, {}, { n: null }, 'str']
const shape = (r) => JSON.stringify(r.valid ? { valid: true } : { valid: false, errors: r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath, e.message]) })

let compared = 0
function compare (schema, expectEngine) {
  const fast = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  assert.strictEqual(fast.engine(), expectEngine, `engine for ${JSON.stringify(schema.properties.n)}`)
  for (const d of docs) {
    assert.strictEqual(shape(fast.validate(structuredClone(d))), shape(interp.validate(structuredClone(d))), `${JSON.stringify(schema.properties.n)} on ${JSON.stringify(d)}`)
    assert.strictEqual(fast.isValidObject(structuredClone(d)), interp.isValidObject(structuredClone(d)))
    compared++
  }
}

for (const [k, v] of Object.entries(ANNOTATIONS)) {
  compare({ $defs: { t: target }, type: 'object', properties: { n: { $ref: '#/$defs/t', [k]: v } } }, 'codegen')
}
compare({ $defs: { t: target }, type: 'object', properties: { n: { $ref: '#/$defs/t', ...ANNOTATIONS } } }, 'codegen')
for (const [k, v] of Object.entries(VALIDATING)) {
  const schema = { $defs: { t: target }, type: 'object', properties: { n: { $ref: '#/$defs/t', description: 'd', [k]: v } } }
  const fast = new Validator(schema)
  assert.notStrictEqual(fast.engine(), 'codegen', `a validating sibling ${k} must not take the $ref-only path`)
  const interp = new Validator(schema, { engine: 'interpreter' })
  for (const d of docs) { assert.strictEqual(shape(fast.validate(structuredClone(d))), shape(interp.validate(structuredClone(d))), `${k} on ${JSON.stringify(d)}`); compared++ }
}
console.log(`ok: $ref with annotation siblings compiles and agrees with the interpreter; validating siblings still decline (${compared} comparisons)`)
