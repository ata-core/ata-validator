'use strict'

// The standalone module's parse(): validate, then return a copy holding only
// the properties the schema declares.
//
// It is the sanitising counterpart to removeAdditional, with two differences
// that matter. It reads the keys the schema names instead of enumerating the
// input and deleting what does not belong, so it costs O(schema) rather than
// O(input) and keeps one hidden class. And it leaves the caller's object
// alone, which removeAdditional cannot do.
//
// It is emitted only where the rebuild is provably exact. Anything that makes
// the allowed key set someone else's decision ($ref, composition,
// patternProperties, an additionalProperties schema) gets no parse() at all,
// because a sanitiser that silently drops an allowed property is worse than
// one that does not exist.

const { Validator } = require('..')
const { toStandaloneModule } = require('../lib/aot.js')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

let failed = 0
const check = (name, cond) => {
  if (!cond) { console.error('FAIL ' + name); failed = 1 }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-parse-'))
let n = 0
const compile = (schema) => {
  const src = toStandaloneModule(new Validator(schema), { format: 'cjs', parse: true })
  if (!src) return null
  const file = path.join(dir, 'm' + n++ + '.cjs')
  fs.writeFileSync(file, src)
  return require(file)
}

// 1. strips at every level, leaves the input alone
{
  const schema = {
    type: 'object',
    properties: {
      a: { type: 'number' },
      nested: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          deeper: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] },
        },
        required: ['x', 'deeper'],
      },
    },
    required: ['a', 'nested'],
  }
  const m = compile(schema)
  check('parse is emitted for a plain object schema', m && typeof m.parse === 'function')
  const input = { a: 1, e1: 1, nested: { x: 2, e2: 2, deeper: { y: 3, e3: 3 } } }
  const frozen = JSON.stringify(input)
  const out = m.parse(input)
  check('strips every level', JSON.stringify(out) === JSON.stringify({ a: 1, nested: { x: 2, deeper: { y: 3 } } }))
  check('input is untouched', JSON.stringify(input) === frozen)
  check('returns a different object', out !== input && out.nested !== input.nested)
}

// 2. optional properties appear only when the input had them
{
  const m = compile({
    type: 'object',
    properties: { a: { type: 'number' }, opt: { type: 'string' } },
    required: ['a'],
  })
  const present = m.parse({ a: 1, opt: 'x', extra: 1 })
  check('optional kept when present', JSON.stringify(present) === JSON.stringify({ a: 1, opt: 'x' }))
  const absent = m.parse({ a: 1, extra: 1 })
  check('optional absent stays absent', !('opt' in absent))
  check('absent case still strips', JSON.stringify(absent) === JSON.stringify({ a: 1 }))
}

// 3. an invalid document throws rather than returning a partial copy
{
  const m = compile({ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] })
  let name = null
  try { m.parse({ a: 'not a number' }) } catch (e) { name = e.name }
  check('throws on invalid', name === 'AtaValidationError')
  let missing = false
  try { m.parse({}) } catch { missing = true }
  check('throws on missing required', missing)
}

// 4. parse agrees with validate on the same documents
{
  const schema = {
    type: 'object',
    properties: { a: { type: 'integer', minimum: 1 }, s: { type: 'string', minLength: 2 } },
    required: ['a', 's'],
  }
  const m = compile(schema)
  const corpus = [
    { a: 1, s: 'ok' }, { a: 0, s: 'ok' }, { a: 1, s: 'x' }, { a: 1.5, s: 'ok' },
    { a: 1, s: 'ok', extra: true }, {}, { a: 1 }, { s: 'ok' },
  ]
  for (const d of corpus) {
    const valid = m.isValid(d)
    let parsed = true
    try { m.parse(d) } catch { parsed = false }
    check('parse and isValid agree on ' + JSON.stringify(d), valid === parsed)
  }
}

// 5. shapes where the clone cannot be proven exact get no parse()
{
  const cases = [
    ['$ref', { $defs: { n: { type: 'object', properties: { x: { type: 'number' } } } }, type: 'object', properties: { a: { $ref: '#/$defs/n' } }, required: ['a'] }],
    ['allOf', { allOf: [{ type: 'object', properties: { a: { type: 'number' } } }] }],
    ['patternProperties', { type: 'object', properties: { a: { type: 'number' } }, patternProperties: { '^x': { type: 'number' } } }],
    ['additionalProperties schema', { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: { type: 'string' } }],
    ['nested $ref', { $defs: { n: { type: 'object', properties: { x: { type: 'number' } } } }, type: 'object', properties: { nested: { type: 'object', properties: { deep: { $ref: '#/$defs/n' } }, required: ['deep'] } }, required: ['nested'] }],
  ]
  for (const [name, schema] of cases) {
    const m = compile(schema)
    check('no parse for ' + name, !m || typeof m.parse !== 'function')
  }
}

// 6. off by default: an emitted module carries no parse() unless asked
{
  const plain = toStandaloneModule(
    new Validator({ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }),
    { format: 'cjs' },
  )
  check('no parse without the option', !/_ataParse/.test(plain))
}

// 7. the boolean and error entry points are unchanged by any of this
{
  const m = compile({ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] })
  check('isValid still works', m.isValid({ a: 1 }) === true && m.isValid({}) === false)
  const r = m.validate({})
  check('validate still reports', r.valid === false && r.errors.length > 0)
}

fs.rmSync(dir, { recursive: true, force: true })
if (failed) process.exit(1)
console.log('aot parse: strips to the declared shape, declines where it cannot prove the copy')
