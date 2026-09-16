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

// 1b. arrays of objects are rebuilt element by element
{
  const m = compile({
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' } },
      images: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'number' }, url: { type: 'string' } },
          required: ['id', 'url'],
        },
      },
    },
    required: ['tags', 'images'],
  })
  check('parse is emitted for an array of objects', m && typeof m.parse === 'function')
  const input = { tags: ['a'], images: [{ id: 1, url: 'u', sneaky: true }], extra: 2 }
  const before = JSON.stringify(input)
  const out = m.parse(input)
  check('strips inside the array', JSON.stringify(out) === JSON.stringify({ tags: ['a'], images: [{ id: 1, url: 'u' }] }))
  check('array elements are new objects', out.images[0] !== input.images[0])
  check('array-of-objects input untouched', JSON.stringify(input) === before)
  check('an empty array survives', JSON.stringify(m.parse({ tags: [], images: [] })) === JSON.stringify({ tags: [], images: [] }))
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

// 7. defaults: an absent optional property takes its declared default, and
// an object default is a fresh value on every call, never shared state
{
  const m = compile({
    type: 'object',
    properties: {
      b: { type: 'string' },
      rollout: { type: 'integer', minimum: 0, default: 0 },
      opts: { type: 'object', properties: { x: { type: 'integer' } }, default: { x: 1 } },
      limits: { type: 'object', properties: { cpu: { type: 'number', default: 1.5 }, mem: { type: 'integer' } } },
    },
    required: ['b'],
  })
  check('defaults module emitted', m && typeof m.parse === 'function')
  const r = m.parse({ b: 'x' })
  check('absent optional takes its default', r.rollout === 0 && r.opts.x === 1)
  check('a present value wins over the default', m.parse({ b: 'x', rollout: 7 }).rollout === 7)
  check('object defaults are fresh per call', m.parse({ b: 'x' }).opts !== m.parse({ b: 'x' }).opts)
  check('nested default fills only under a present parent',
    m.parse({ b: 'x' }).limits === undefined && m.parse({ b: 'x', limits: { mem: 2 } }).limits.cpu === 1.5)
}

// 8. the two default shapes that would diverge from the runtime decline:
// a required property with a default (the runtime fills it before checking
// required, a raw-input validation cannot), and a default the property's own
// schema rejects (the runtime catches it at validation, parse would ship it)
{
  const rd = toStandaloneModule(
    new Validator({ type: 'object', properties: { a: { type: 'integer', default: 3 } }, required: ['a'] }),
    { format: 'cjs', parse: true },
  )
  check('required with default gets no parse', !/_ataParse/.test(rd))
  const bad = toStandaloneModule(
    new Validator({ type: 'object', properties: { a: { type: 'integer', default: 'nope' }, b: { type: 'string' } }, required: ['b'] }),
    { format: 'cjs', parse: true },
  )
  check('an invalid default gets no parse', !/_ataParse/.test(bad))
}

// 9. in-place applicators are admitted when they only constrain: the
// if/then/else config shape with root unevaluatedProperties: false now gets
// a parse() that enforces the conditional and rejects undeclared keys
{
  const m = compile({
    type: 'object',
    properties: { on: { type: 'boolean' }, why: { type: 'string', minLength: 1 }, tag: { type: 'string', default: 'none' } },
    required: ['on'],
    if: { properties: { on: { const: true } }, required: ['on'] },
    then: { required: ['why'] },
    unevaluatedProperties: false,
  })
  check('composed config shape gets parse', m && typeof m.parse === 'function')
  check('defaults still fill there', m.parse({ on: false }).tag === 'none')
  let threw = false
  try { m.parse({ on: true }) } catch { threw = true }
  check('the then branch is enforced', threw)
  threw = false
  try { m.parse({ on: false, stray: 1 }) } catch { threw = true }
  check('unevaluatedProperties: false rejects an undeclared key', threw)
  // and the shapes that widen the key set still decline
  const refd = toStandaloneModule(
    new Validator({ $defs: { b: { properties: { extra: {} } } }, type: 'object', properties: { a: { type: 'integer' } }, allOf: [{ $ref: '#/$defs/b' }] }),
    { format: 'cjs', parse: true },
  )
  check('a $ref in an applicator still gets no parse', !/_ataParse/.test(refd))
  const widen = toStandaloneModule(
    new Validator({ type: 'object', properties: { a: { type: 'integer' } }, allOf: [{ properties: { other: { type: 'string' } } }] }),
    { format: 'cjs', parse: true },
  )
  check('an applicator declaring a new name still gets no parse', !/_ataParse/.test(widen))
}

// 10. the boolean and error entry points are unchanged by any of this
{
  const m = compile({ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] })
  check('isValid still works', m.isValid({ a: 1 }) === true && m.isValid({}) === false)
  const r = m.validate({})
  check('validate still reports', r.valid === false && r.errors.length > 0)
}

fs.rmSync(dir, { recursive: true, force: true })
if (failed) process.exit(1)
console.log('aot parse: strips, defaults, composed shapes under the subset proof; declines where it cannot prove the copy')
