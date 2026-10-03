'use strict'

// A JSON Pointer in a URI fragment is percent-encoded: a definition named
// `Node<Row>` is reached by `#/definitions/Node%3CRow%3E`. ts-json-schema-generator
// writes generic type names exactly like this. The interpreter decoded the
// fragment, the code generator did not, so it declined the whole document: one
// such reference in PostHog's 1173-definition query schema sent every validator
// built from it to the interpreter, and `ata compile` refused it as too complex.
// Normalization now rewrites the reference to its decoded pointer, so every
// engine reads the same text. This checks the answers on every engine, that the
// constraint behind the reference is applied, and the two cases that must be
// left alone: a name that itself holds a `%`, and a `$ref` inside data.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-encoded-ref-'))
let n = 0
function standalone (v) {
  const src = toStandaloneModule(v, { format: 'cjs', abortEarly: true })
  if (!src) return null
  const f = path.join(dir, `m${n++}.cjs`)
  fs.writeFileSync(f, src)
  return require(f)
}

const row = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } }, additionalProperties: false }

const cases = [
  {
    name: 'generic type name, draft-07 definitions',
    schema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', items: { $ref: '#/definitions/Node%3CRow%3E' }, definitions: { 'Node<Row>': row } },
    good: [[], [{ id: 1 }, { id: 2 }]],
    bad: [[{ id: 0 }], [{}], [{ id: 1, x: 1 }], [{ id: 'a' }]],
    codegen: true,
  },
  {
    name: 'space in the name, 2020-12 $defs',
    schema: { type: 'object', properties: { r: { $ref: '#/$defs/a%20row' } }, $defs: { 'a row': row } },
    good: [{}, { r: { id: 3 } }],
    bad: [{ r: { id: -1 } }, { r: [] }],
    codegen: true,
  },
  {
    name: 'an escaped slash is a pointer separator after decoding',
    schema: { type: 'object', properties: { r: { $ref: '#/$defs/a~1b' }, s: { $ref: '#/$defs/a%7E1b' } }, $defs: { 'a/b': row } },
    good: [{ r: { id: 1 }, s: { id: 2 } }],
    bad: [{ r: { id: 0 } }, { s: { id: 0 } }],
    codegen: null,
  },
  {
    name: 'a name holding % is decoded once, not twice',
    schema: { type: 'object', properties: { r: { $ref: '#/$defs/100%25' } }, $defs: { '100%': row } },
    good: [{ r: { id: 1 } }],
    bad: [{ r: { id: 0 } }],
    codegen: null,
  },
]

let compiled = 0
let checked = 0
for (const c of cases) {
  const before = JSON.stringify(c.schema)
  const runtime = new Validator(c.schema)
  const interp = new Validator(c.schema, { engine: 'interpreter' })
  runtime.isValidObject(c.good[0])
  assert.strictEqual(JSON.stringify(c.schema), before, `${c.name}: the caller's schema is not changed`)
  if (c.codegen) {
    assert.strictEqual(runtime.engine(), 'codegen', `${c.name}: compiles to generated code`)
    compiled++
  }
  const mod = standalone(runtime)
  if (c.codegen) assert.ok(mod, `${c.name}: compiles to a standalone module`)
  for (const [docs, want] of [[c.good, true], [c.bad, false]]) {
    for (const d of docs) {
      const text = JSON.stringify(d)
      assert.strictEqual(interp.validate(JSON.parse(text)).valid, want, `${c.name}: interpreter on ${text}`)
      assert.strictEqual(runtime.validate(JSON.parse(text)).valid, want, `${c.name}: validate on ${text}`)
      assert.strictEqual(runtime.isValidObject(JSON.parse(text)), want, `${c.name}: isValidObject on ${text}`)
      assert.strictEqual(runtime.validateJSON(text).valid, want, `${c.name}: validateJSON on ${text}`)
      if (mod) assert.strictEqual(mod.isValid(JSON.parse(text)), want, `${c.name}: standalone on ${text}`)
      checked++
    }
  }
}

// A `$ref` inside data is a value to compare, not a reference to rewrite.
{
  const schema = { type: 'object', properties: { k: { const: { $ref: '#/$defs/a%20b' } }, r: { $ref: '#/$defs/a%20b' } }, $defs: { 'a b': { type: 'string' } } }
  const v = new Validator(schema)
  assert.strictEqual(v.validate({ k: { $ref: '#/$defs/a%20b' }, r: 'x' }).valid, true, 'const keeps the encoded text')
  assert.strictEqual(v.validate({ k: { $ref: '#/$defs/a b' } }).valid, false, 'and does not match the decoded text')
  assert.strictEqual(v.validate({ r: 1 }).valid, false, 'the reference beside it still applies')
  checked += 3
}

fs.rmSync(dir, { recursive: true, force: true })
assert.ok(compiled >= 2, `too few cases reached generated code: ${compiled}`)
console.log(`ok: percent-encoded $ref fragments resolve on every engine (${checked} checks, ${compiled} cases on generated code)`)
