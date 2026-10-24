'use strict'

// A validator the build compiled away (fromCompiled around a module written
// ahead of time) carries Standard Schema V1 as the runtime Validator does, so
// a form library or a router that reads `~standard` gets the same issues, the
// same value and the same schema from either. Without it, a validator handed
// to such a consumer stopped working once a bundler plugin replaced it.

const assert = require('node:assert')
const { Validator } = require('..')
const { compiledModuleFor, compiledSchemaFor } = require('../build.js')
const { fromCompiled } = require('../compiled.js')

const load = (src) => { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); return m.exports }
const compiled = (schema) => fromCompiled(load(compiledModuleFor(schema, { format: 'cjs' })), compiledSchemaFor(schema), { useDefaults: false })

const SCHEMAS = [
  { type: 'object', required: ['email', 'age'], properties: { email: { type: 'string', format: 'email' }, age: { type: 'integer', minimum: 13 }, tags: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 3 } }, additionalProperties: false },
  { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { 'a/b': { type: 'string' }, list: { type: 'array', items: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } } }, kind: { enum: ['x', 'y'] } } },
  { type: 'object', $defs: { addr: { type: 'object', required: ['zip'], properties: { zip: { type: 'string', pattern: '^[0-9]{5}$' } } } }, properties: { home: { $ref: '#/$defs/addr' }, work: { $ref: '#/$defs/addr' } } },
]
const DOCS = [
  {}, { email: 'a@b.co', age: 20 }, { email: 'x', age: 3, tags: ['', 'a', 'b', 'c'], extra: 1 }, { 'a/b': 1, list: [{ n: 1 }, {}, { n: 'x' }], kind: 'z' },
  { home: { zip: '1' }, work: {} }, 'nope', null, [],
]
const shape = (r) => JSON.stringify(r.issues ? { issues: r.issues.map((i) => [i.message, i.path]) } : { value: r.value })

let cases = 0
for (const schema of SCHEMAS) {
  const rt = new Validator(schema, { useDefaults: false })['~standard']
  const cp = compiled(schema)['~standard']
  assert.strictEqual(cp.version, 1)
  assert.strictEqual(cp.vendor, rt.vendor)
  const target = typeof schema.$schema === 'string' && schema.$schema.includes('draft-07') ? 'draft-07' : 'draft-2020-12'
  assert.deepStrictEqual(cp.jsonSchema.input({ target }), rt.jsonSchema.input({ target }), 'the published schema')
  assert.throws(() => cp.jsonSchema.input({ target: 'openapi-3.0' }), TypeError)
  for (const d of DOCS) {
    const a = rt.validate(structuredClone(d)), b = cp.validate(structuredClone(d))
    assert.strictEqual(shape(b), shape(a), `${JSON.stringify(schema).slice(0, 40)} on ${JSON.stringify(d)}`)
    cases++
  }
  // Built once and pinned on the instance, not enumerable.
  const v = compiled(schema)
  assert.strictEqual(v['~standard'], v['~standard'])
  assert.ok(!Object.keys(v).includes('~standard'), 'not enumerable')
}

// An extension installed after the fact counts in the issues, as in the runtime.
{
  const schema = { type: 'object', properties: { n: { type: 'integer' } } }
  const v = compiled(schema)
  v._extendChecks(() => ({ check: (d) => d && d.n !== 7, errors: () => [{ keyword: 'banned', instancePath: '/n', schemaPath: '#', message: 'seven is banned', params: {} }] }))
  const r = v['~standard'].validate({ n: 7 })
  assert.ok(r.issues && r.issues.some((i) => i.message === 'seven is banned' && i.path[0].key === 'n'), JSON.stringify(r))
  assert.deepStrictEqual(v['~standard'].validate({ n: 8 }), { value: { n: 8 } })
}

console.log(`ok: compiled validators carry Standard Schema as the runtime does; ${cases} cases agree`)
