'use strict'

// oneOf and anyOf count their passing branches with verdict functions and run
// the error-collecting branches only when none passes. This compares every
// read with the interpreter on zero, one and several passing branches, nested,
// and on the schema where a declined branch verdict once left a reference on
// the compile context and the next error function wrote that branch as
// nothing, which read as valid and surfaced as a placeholder error.

const assert = require('node:assert')
const { Validator } = require('..')

const schemas = [
  { oneOf: [{ type: 'integer' }, { minimum: 2 }] },
  { anyOf: [{ type: 'string', minLength: 3 }, { type: 'integer', maximum: 5 }] },
  { oneOf: [{ oneOf: [{ type: 'boolean' }, { const: 1 }] }, { anyOf: [{ const: 1 }, { type: 'null' }] }] },
  { type: 'array', items: { oneOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }, { type: 'string' }] } },
  {
    oneOf: [{ oneOf: [{ type: 'boolean' }, { $ref: '#/$defs/B' }] }, { $ref: '#/$defs/B' }],
    $defs: {
      A: { type: 'object', properties: { 'k~1': { type: 'string', minLength: 2 }, b: { type: 'array', items: true, maxItems: 3 }, c: { $ref: '#/$defs/A' } } },
      B: { anyOf: [false, { $ref: '#/$defs/A' }] },
    },
  },
]
const docs = [0, 1, 2, 3, 1.5, 7, 'ab', 'abcd', true, null, [], {}, { a: 1 }, { b: 1 }, { a: 1, b: 1 },
  [{ a: 1 }, { b: 1 }, { a: 1, b: 1 }, 'x', 3], { 'k~1': 'a' }, { c: { c: { b: [1, 2, 3, 4] } } }, { 'k~1': 'abc', c: {} }]
const plain = (r) => JSON.stringify((r.errors || []).map((e) => ({ keyword: e.keyword, instancePath: e.instancePath, schemaPath: e.schemaPath, params: e.params, message: e.message })))

let compared = 0
schemas.forEach((schema, i) => {
  for (const $schema of ['https://json-schema.org/draft/2020-12/schema', 'http://json-schema.org/draft-07/schema#']) {
    for (const richErrors of [false, true]) {
      const a = new Validator({ $schema, ...schema }, { richErrors })
      const b = new Validator({ $schema, ...schema }, { richErrors, engine: 'interpreter' })
      for (const doc of docs) {
        for (let r = 0; r < 80; r++) { const x = a.validate(doc); if (!x.valid) void x.errors }
        const ra = a.validate(doc), rb = b.validate(doc)
        assert.strictEqual(ra.valid, rb.valid, `verdict, schema ${i}, ${JSON.stringify(doc)}`)
        assert.strictEqual(plain(ra), plain(rb), `errors, schema ${i} ${$schema} richErrors ${richErrors}, ${JSON.stringify(doc)}`)
        compared++
      }
    }
  }
})

// The verdict path is the one taken.
{
  const sources = []
  const F = globalThis.Function
  globalThis.Function = new Proxy(F, {
    construct (t, a) { sources.push(String(a[a.length - 1])); return Reflect.construct(t, a) },
    apply (t, th, a) { sources.push(String(a[a.length - 1])); return Reflect.apply(t, th, a) },
  })
  try {
    const v = new Validator({ oneOf: [{ type: 'number' }, { minimum: 0 }, { maximum: 9 }] }, { richErrors: false })
    for (let r = 0; r < 80; r++) { const x = v.validate(3); if (!x.valid) void x.errors }
  } finally {
    globalThis.Function = F
  }
  assert.ok(sources.some((x) => /_bvf\d+_0\(/.test(x)), 'expected branch verdicts in the generated source')
}
console.log(`ok: oneOf and anyOf counted by branch verdicts report as the interpreter does (${compared} documents)`)
