'use strict'

// removeAdditional keeps the keys a patternProperties pattern matches (issue
// #117). They are not additional properties: the check accepts them, so
// deleting them dropped valid data from a document that then passed, and
// nothing reported it. Every path that removes is held to the same answer:
// generated code (which hands such a schema to the closure pass), the
// interpreted engine, the closure tree, the text path, ata-validator/lite and
// ata-validator/ir.

const assert = require('assert')
const path = require('path')
const { Validator } = require('..')
const lite = require('../lite')

const schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    meta: {
      type: 'object',
      properties: { a: { type: 'integer' } },
      patternProperties: { '^x-': { type: 'string' }, '^\\d+$': {} },
      additionalProperties: false,
    },
  },
  patternProperties: { '^x-': {} },
  additionalProperties: false,
}
const input = () => ({ id: 1, 'x-trace': 'abc', extra: 1, meta: { a: 1, 'x-y': 'v', 42: true, b: 3 } })
const want = { id: 1, 'x-trace': 'abc', meta: { a: 1, 'x-y': 'v', 42: true } }

const paths = {
  'generated code': (d) => new Validator(schema, { removeAdditional: true }).validate(d),
  'generated code, hot': (d) => { const v = new Validator(schema, { removeAdditional: true }); for (let i = 0; i < 80; i++) v.validate(input()); return v.validate(d) },
  'interpreted engine': (d) => new Validator(schema, { removeAdditional: true, engine: 'interpreter' }).validate(d),
  'closure tree': (d) => { const v = new Validator(schema, { removeAdditional: true, engine: 'interpreter' }); for (let i = 0; i < 1100; i++) v.isValidObject(input()); return v.validate(d) },
  'isValidObject': (d) => ({ valid: new Validator(schema, { removeAdditional: true }).isValidObject(d) }),
  'lite': (d) => new lite.Validator(schema, { removeAdditional: true }).validate(d),
}
for (const [name, run] of Object.entries(paths)) {
  const d = input()
  const r = run(d)
  assert.strictEqual(r.valid, true, `${name}: valid`)
  assert.deepStrictEqual(d, want, `${name}: keeps the keys a pattern matches and removes the rest`)
}

// The text path answers on the parsed document; the kept keys show in the
// verdict: a pattern-matched key with the wrong type is still rejected.
{
  const v = new Validator(schema, { removeAdditional: true })
  assert.strictEqual(v.validateJSON(JSON.stringify(input())).valid, true, 'validateJSON: valid')
  const bad = input(); bad.meta['x-y'] = 5
  assert.strictEqual(v.validate(bad).valid, false, 'a kept key is still checked against its pattern schema')
}

// Without patternProperties nothing changes: the generated pass still runs.
{
  const plain = { type: 'object', properties: { id: { type: 'integer' } }, additionalProperties: false }
  const d = { id: 1, 'x-trace': 'abc' }
  assert.strictEqual(new Validator(plain, { removeAdditional: true }).validate(d).valid, true)
  assert.deepStrictEqual(d, { id: 1 }, 'a closed object without patterns still loses undeclared keys')
}

;(async () => {
  const ir = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'lib', 'ir', 'index.mjs')).href)
  const d = input()
  const r = ir.compileClosures(schema, { removeAdditional: true }).validate(d)
  assert.strictEqual(r.valid, true, 'ir closures: valid')
  assert.deepStrictEqual(d, want, 'ir closures: same document')
  console.log('ok: removeAdditional keeps patternProperties keys on every path')
})().catch((e) => { console.error(e); process.exit(1) })
