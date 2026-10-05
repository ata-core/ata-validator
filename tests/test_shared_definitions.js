'use strict'

// Definitions referenced from several places are written once as functions:
// in the verdict function when its source passes 64 KB expanded, and in the
// combined function always. Neither happens on the suite's small schemas, so
// this builds one that needs both, with nested references, a oneOf and a
// runtime unevaluatedProperties inside shared definitions, and compares every
// read with the interpreter on accepted and rejected documents.

const assert = require('node:assert')
const { Validator } = require('..')

function build () {
  const $defs = {
    leaf: { type: 'object', properties: { id: { type: 'integer', minimum: 0 }, name: { type: 'string', minLength: 2 }, tag: { enum: ['a', 'b', 'c'] } }, required: ['id'] },
    pair: { type: 'object', properties: { left: { $ref: '#/$defs/leaf' }, right: { $ref: '#/$defs/leaf' } }, additionalProperties: false },
    choice: { oneOf: [{ $ref: '#/$defs/leaf' }, { type: 'array', items: { $ref: '#/$defs/leaf' }, maxItems: 3 }] },
    open: { type: 'object', properties: { kind: { const: 'open' } }, anyOf: [{ properties: { x: { type: 'number' } } }, { properties: { y: { type: 'string' } } }], unevaluatedProperties: false },
  }
  const properties = {}
  for (let i = 0; i < 60; i++) {
    properties['p' + i] = { $ref: '#/$defs/pair' }
    properties['c' + i] = { $ref: '#/$defs/choice' }
    properties['o' + i] = { $ref: '#/$defs/open' }
  }
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties, $defs }
}
const schema = build()
const leaf = (i) => ({ id: i, name: 'nm' + i, tag: 'abc'[i % 3] })
const docs = [
  {},
  { p0: { left: leaf(1), right: leaf(2) }, c0: leaf(3), o0: { kind: 'open', x: 1 } },
  { p5: { left: leaf(1), right: { id: -1 } } },
  { p5: { left: leaf(1), extra: 1 } },
  { c7: [leaf(1), leaf(2)] },
  { c7: [leaf(1), leaf(2), leaf(3), leaf(4)] },
  { c7: { id: 'x' } },
  { c8: 'nope' },
  { o9: { kind: 'open', x: 1, y: 'a' } },
  { o9: { kind: 'open', z: 1 } },
  { o9: { kind: 'shut', x: 'no' } },
  { p59: { left: { id: 1, name: 'x', tag: 'zz' } }, o59: { kind: 'open', y: 2 }, c59: [{}] },
]
const plain = (r) => JSON.stringify((r.errors || []).map((e) => ({ keyword: e.keyword, instancePath: e.instancePath, schemaPath: e.schemaPath, params: e.params, message: e.message })))

// The shared forms are the ones taken.
{
  const sources = []
  const F = globalThis.Function
  globalThis.Function = new Proxy(F, {
    construct (t, a) { sources.push(String(a[a.length - 1])); return Reflect.construct(t, a) },
    apply (t, th, a) { sources.push(String(a[a.length - 1])); return Reflect.apply(t, th, a) },
  })
  try {
    const v = new Validator(schema, { richErrors: false })
    for (let r = 0; r < 80; r++) { const x = v.validate(docs[2]); if (!x.valid) void x.errors }
  } finally {
    globalThis.Function = F
  }
  assert.ok(sources.some((x) => /function _dv\d+_pair\(d\)/.test(x)), 'expected the verdict to share definitions')
  assert.ok(sources.some((x) => /function _defC\d+_pair\(/.test(x)), 'expected the combined function to share definitions')
  const verdict = sources.find((x) => /function _dv\d+_pair\(d\)/.test(x))
  assert.ok(verdict.length < 64 * 1024, `verdict source ${verdict.length} characters`)
}

let compared = 0
for (const richErrors of [false, true]) {
  const a = new Validator(schema, { richErrors })
  const b = new Validator(schema, { richErrors, engine: 'interpreter' })
  for (const doc of docs) {
    for (let r = 0; r < 80; r++) { const x = a.validate(doc); if (!x.valid) void x.errors }
    const ra = a.validate(doc), rb = b.validate(doc)
    assert.strictEqual(ra.valid, rb.valid, `verdict, ${JSON.stringify(doc)}`)
    assert.strictEqual(a.isValidObject(doc), rb.valid, `isValidObject, ${JSON.stringify(doc)}`)
    assert.strictEqual(plain(ra), plain(rb), `errors, richErrors ${richErrors}, ${JSON.stringify(doc)}`)
    compared++
  }
}
console.log(`ok: shared definitions in the verdict and combined functions answer as the interpreter does (${compared} documents)`)

// A definition on a cycle behind a oneOf branch, which the combined function
// now runs under the cycle guard instead of declining: data that points back
// at itself and data nested past the guard's depth answer as the interpreter
// does, with no exception reaching the caller.
{
  const cyc = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    oneOf: [{ $ref: '#/$defs/A' }, { type: 'array' }],
    $defs: { A: { type: 'object', properties: { n: { type: 'integer' }, c: { $ref: '#/$defs/A' } } } },
  }
  const self = { n: 1 }; self.c = self
  const selfBad = { n: 'x' }; selfBad.c = selfBad
  let deep = { n: 1 }; for (let i = 0; i < 700; i++) deep = { n: i, c: deep }
  let deepBad = { n: 'x' }; for (let i = 0; i < 700; i++) deepBad = { n: i, c: deepBad }
  for (const richErrors of [false, true]) {
    const a = new Validator(cyc, { richErrors })
    const b = new Validator(cyc, { richErrors, engine: 'interpreter' })
    for (const doc of [self, selfBad, deep, deepBad, { n: 1, c: { n: 'y' } }, []]) {
      for (let r = 0; r < 80; r++) { const x = a.validate(doc); if (!x.valid) void x.errors }
      const ra = a.validate(doc), rb = b.validate(doc)
      assert.strictEqual(ra.valid, rb.valid, 'cyclic verdict')
      // Errors only for data that does not point back at itself: on such data
      // the guarded pass reports a repeated object once, and two branches can
      // then tie where the interpreter breaks the tie the other way. That was
      // already so through the error function before this path existed, and
      // JSON text cannot produce such data.
      if (doc !== self && doc !== selfBad) assert.strictEqual(plain(ra), plain(rb), `cyclic errors, richErrors ${richErrors}`)
    }
  }
  console.log('ok: a cyclic definition behind a branch answers as the interpreter does under the guard')
}

// Recursive schemas get a combined function: `$ref: "#"` calls the root as a
// function, a definition on a cycle calls itself, both under the cycle guard.
// These declined before and validated twice per read error.
{
  const rec = [
    { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['a'], properties: { a: { type: 'integer' }, child: { $ref: '#' } } },
    { $schema: 'http://json-schema.org/draft-07/schema#', $ref: '#/definitions/node', definitions: { node: { type: 'object', properties: { v: { type: 'integer' }, kids: { type: 'array', items: { $ref: '#/definitions/node' } } }, required: ['v'] } } },
  ]
  let deep = { a: 1 }; for (let i = 0; i < 40; i++) deep = { a: i, child: deep }
  let deepBad = { a: 'x' }; for (let i = 0; i < 40; i++) deepBad = { a: i, child: deepBad }
  const docs = [[{ a: 1 }, { a: 1, child: { a: 2, child: {} } }, { a: 1, child: { a: 'z' } }, {}, deep, deepBad, []],
    [{ v: 1 }, { v: 1, kids: [{ v: 2, kids: [{ v: 'x' }] }] }, { kids: [{}] }, { v: 'a', kids: [{ v: 'b' }, 3] }, 'no']]
  const sources = []
  const F = globalThis.Function
  globalThis.Function = new Proxy(F, {
    construct (t, a) { sources.push(String(a[a.length - 1])); return Reflect.construct(t, a) },
    apply (t, th, a) { sources.push(String(a[a.length - 1])); return Reflect.apply(t, th, a) },
  })
  try {
    rec.forEach((schema, i) => {
      for (const richErrors of [false, true]) {
        const a = new Validator(schema, { richErrors })
        const b = new Validator(schema, { richErrors, engine: 'interpreter' })
        for (const doc of docs[i]) {
          for (let r = 0; r < 80; r++) { const x = a.validate(doc); if (!x.valid) void x.errors }
          const ra = a.validate(doc), rb = b.validate(doc)
          assert.strictEqual(ra.valid, rb.valid, `recursive verdict ${i}`)
          assert.strictEqual(plain(ra), plain(rb), `recursive errors ${i}, richErrors ${richErrors}, ${JSON.stringify(doc).slice(0, 80)}`)
        }
      }
    })
  } finally {
    globalThis.Function = F
  }
  assert.ok(sources.some((x) => /function _defC\d+_root_b\(/.test(x)), 'expected `$ref: "#"` as a guarded root function')
  assert.ok(sources.some((x) => /function _defC\d+_node_b\(/.test(x)), 'expected the cyclic definition as a guarded function')
  console.log('ok: recursive schemas answer as the interpreter does through the combined function')
}
