'use strict'

// A node with runtime unevaluatedProperties counts its anyOf and oneOf
// branches through annotation functions, and the keywords' own error code
// reuses that count: it skips its branches when the keyword holds, and builds
// the more-than-one oneOf error from which branches passed. The count is
// read only for the object it was taken on. This compares every error list
// with the interpreter's on shapes where a stale count would be wrong: the
// same node under a pattern and in array items, applied to objects and to
// values that are not objects in turn, and nested oneOf behind references.

const assert = require('node:assert')
const { Validator } = require('..')

const node = {
  type: ['object', 'string', 'integer'],
  oneOf: [
    { required: ['a'], properties: { a: { type: 'integer' } } },
    { required: ['b'], properties: { b: true } },
    { type: 'string', minLength: 3 },
  ],
  anyOf: [
    { properties: { c: { const: 1 } } },
    { required: ['d'], properties: { d: true } },
    { type: 'string' },
  ],
  unevaluatedProperties: false,
}
const schemas = [
  { $schema: 'https://json-schema.org/draft/2020-12/schema', ...node },
  { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', patternProperties: { '^p': node } },
  { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array', items: node },
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: {
      one: { oneOf: [{ $ref: '#/$defs/two' }, { required: ['b'], properties: { b: true } }, { required: ['xx'], patternProperties: { x: true } }] },
      two: { oneOf: [{ required: ['c'], properties: { c: true } }, { required: ['d'], properties: { d: true } }] },
    },
    oneOf: [{ $ref: '#/$defs/one' }, { required: ['a'], properties: { a: true } }],
    unevaluatedProperties: false,
  },
]
const values = [
  {}, { a: 1 }, { b: 1 }, { a: 1, b: 1 }, { a: 'x' }, { a: 1, c: 1 }, { a: 1, d: 1 }, { a: 1, e: 1 },
  { b: 1, c: 2 }, { a: 1, b: 1, d: 1 }, { c: 1 }, { d: 1 }, { xx: 1 }, { xx: 1, foo: 1 }, { c: 1, d: 1 },
  'abcd', 'ab', 7, null, [],
]
const docsFor = (i) => {
  if (i === 1) {
    const out = []
    for (let k = 0; k < values.length; k++) out.push({ p1: values[k], p2: values[(k + 7) % values.length], p3: values[(k + 3) % values.length] })
    return out
  }
  if (i === 2) {
    const out = []
    for (let k = 0; k < values.length; k++) out.push([values[k], values[(k + 5) % values.length], values[(k + 11) % values.length], values[k]])
    return out
  }
  return values
}
const plain = (r) => JSON.stringify((r.errors || []).map((e) => ({ keyword: e.keyword, instancePath: e.instancePath, schemaPath: e.schemaPath, params: e.params, message: e.message })))

// The path is taken: the generated source shares the counts. Without this
// the comparisons above would pass just as well with the sharing off.
{
  const sources = []
  const F = globalThis.Function
  globalThis.Function = new Proxy(F, {
    construct (t, a) { sources.push(String(a[a.length - 1])); return Reflect.construct(t, a) },
    apply (t, th, a) { sources.push(String(a[a.length - 1])); return Reflect.apply(t, th, a) },
  })
  try {
    for (const schema of [schemas[0], schemas[1], schemas[3]]) {
      const v = new Validator(schema, { richErrors: false })
      for (let r = 0; r < 80; r++) { const res = v.validate({ a: 1, b: 1, p1: { a: 1, b: 1 } }); for (const e of res.errors || []) void e }
    }
  } finally {
    globalThis.Function = F
  }
  const counted = sources.filter((x) => /_ao\d+===/.test(x)).length
  assert.ok(counted >= 3, `expected the shared count in the generated source, found it in ${counted}`)
  assert.ok(sources.some((x) => x.includes('__ataMulti(')), 'expected a oneOf error built from the count')
}

let compared = 0
schemas.forEach((schema, i) => {
  for (const richErrors of [false, true]) {
    const a = new Validator(schema, { richErrors })
    const b = new Validator(schema, { richErrors, engine: 'interpreter' })
    for (const doc of docsFor(i)) {
      // Past the call count at which the generated validate() takes over.
      for (let r = 0; r < 80; r++) a.validate(doc)
      const ra = a.validate(doc), rb = b.validate(doc)
      assert.strictEqual(ra.valid, rb.valid, `verdict, schema ${i}, ${JSON.stringify(doc)}`)
      assert.strictEqual(plain(ra), plain(rb), `errors, schema ${i}, richErrors ${richErrors}, ${JSON.stringify(doc)}`)
      compared++
    }
  }
})

console.log(`ok: anyOf and oneOf reuse the unevaluatedProperties branch count and report as the interpreter does (${compared} documents)`)
