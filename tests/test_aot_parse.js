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
// It is emitted only where the rebuild is provably exact. A local, acyclic
// $ref made of nothing but the reference and annotations is inlined first,
// so generated schemas ($defs + $ref) qualify. Anything else that makes the
// allowed key set someone else's decision (a cyclic or external $ref, a $ref
// with constraining siblings, patternProperties, an additionalProperties
// schema) gets no parse() at all, because a sanitiser that silently drops an
// allowed property is worse than one that does not exist. And since 1.26.0
// the decline is loud: onWarning fires and the module carries a NOTE.

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
    ['cyclic $ref', { $defs: { n: { type: 'object', properties: { next: { $ref: '#/$defs/n' } } } }, type: 'object', properties: { a: { $ref: '#/$defs/n' } }, required: ['a'] }],
    ['allOf', { allOf: [{ type: 'object', properties: { a: { type: 'number' } } }] }],
    ['patternProperties', { type: 'object', properties: { a: { type: 'number' } }, patternProperties: { '^x': { type: 'number' } } }],
    ['additionalProperties true', { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: true }],
    ['an applicator next to a record', { type: 'object', additionalProperties: { type: 'string' }, allOf: [{ type: 'object' }] }],
    ['$ref with a constraining sibling', { $defs: { n: { type: 'object', properties: { x: { type: 'number' } } } }, type: 'object', properties: { a: { $ref: '#/$defs/n', minProperties: 1 } } }],
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

// 11. a bare local $ref is inlined, so generated schemas ($defs + $ref) get
// parse() instead of a silent decline. Defaults follow the runtime exactly:
// a default written next to the $ref fills, a default written inside the
// referenced definition does not, because validate() with useDefaults draws
// the same line and parse() must not be more generous than validate().
{
  const schema = {
    type: 'object',
    $defs: {
      address: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          country: { type: 'string', default: 'TR' },
        },
        required: ['city'],
      },
    },
    properties: {
      name: { type: 'string' },
      home: { $ref: '#/$defs/address' },
    },
    required: ['name'],
  }
  const m = compile(schema)
  check('local $ref gets parse', m && typeof m.parse === 'function')
  if (m && typeof m.parse === 'function') {
    const input = { name: 'a', extra: 1, home: { city: 'x', junk: 2 } }
    const out = m.parse(input)
    check('ref target strips unknown keys', out.home && out.home.city === 'x' && !('junk' in out.home) && !('extra' in out))
    check('inner default does not fill, same as the runtime', !('country' in out.home))
    const r = new Validator(schema).validate({ name: 'a', home: { city: 'x' } })
    const p = m.parse({ name: 'a', home: { city: 'x' } })
    check('parse output equals runtime validate().data', JSON.stringify(p) === JSON.stringify(r.data))
  }
}

// 12. a chain of local refs resolves through each hop
{
  const schema = {
    type: 'object',
    $defs: {
      leaf: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] },
      mid: { type: 'object', properties: { leaf: { $ref: '#/$defs/leaf' } }, required: ['leaf'] },
    },
    properties: { top: { $ref: '#/$defs/mid' } },
    required: ['top'],
  }
  const m = compile(schema)
  check('ref chain gets parse', m && typeof m.parse === 'function')
  if (m && typeof m.parse === 'function') {
    const out = m.parse({ top: { leaf: { v: 1, x: 2 }, y: 3 } })
    check('ref chain strips at every hop', out.top.leaf.v === 1 && !('x' in out.top.leaf) && !('y' in out.top))
  }
}

// 13. a cyclic local $ref cannot be inlined: no parse, and the decline is
// loud through onWarning instead of only visible in the export list.
{
  const schema = {
    type: 'object',
    $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' }, v: { type: 'number' } } } },
    properties: { root: { $ref: '#/$defs/node' } },
  }
  const warned = []
  const src = toStandaloneModule(new Validator(schema), {
    format: 'cjs', parse: true, onWarning: (w) => warned.push(w),
  })
  check('cyclic ref gets no parse', !/_ataParse/.test(src))
  check('cyclic ref decline warns', warned.length === 1 && /parse/.test(warned[0]))
}

// 14. a $ref with a non-annotation sibling stays un-inlined. That shape is
// interpreter-only today, so the whole module is declined (null), which the
// build layer already reports; there is no quiet module missing its parse.
{
  const schema = {
    type: 'object',
    $defs: { a: { type: 'object', properties: { v: { type: 'number' } } } },
    properties: { p: { $ref: '#/$defs/a', minProperties: 1 } },
  }
  const src = toStandaloneModule(new Validator(schema), { format: 'cjs', parse: true })
  check('constraining sibling of $ref declines the module, not just parse', src === null)
}

// 15. the declines that already existed are loud now too
{
  const warned = []
  toStandaloneModule(new Validator({ type: 'object', properties: { a: { type: 'number' } }, patternProperties: { '^x': { type: 'number' } } }), {
    format: 'cjs', parse: true, onWarning: (w) => warned.push(w),
  })
  check('patternProperties decline warns', warned.length === 1 && /parse/.test(warned[0]))
}

// 16. no warning when parse is generated, and none when parse was not asked for
{
  const quiet = []
  toStandaloneModule(new Validator({ type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }), {
    format: 'cjs', parse: true, onWarning: (w) => quiet.push(w),
  })
  check('a generated parse does not warn', quiet.length === 0)
  const unasked = []
  toStandaloneModule(new Validator({ type: 'object', $defs: { n: { type: 'object' } }, properties: { p: { $ref: '#/$defs/n' } } }), {
    format: 'cjs', onWarning: (w) => unasked.push(w),
  })
  check('no parse request, no parse warning', unasked.every((w) => !/parse\(\)/.test(w)))
}

// 17a. z.record: additionalProperties as a schema is provable. Every key is
// allowed, every value is rebuilt against that one schema, so the map shape
// generators emit gets a parse() instead of a decline.
{
  const schema = {
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: { include: { type: 'array', items: { type: 'string' } }, note: { type: 'string', default: 'none' } },
      required: ['include'],
    },
  }
  const m = compile(schema)
  check('record gets parse', m && typeof m.parse === 'function')
  if (m && typeof m.parse === 'function') {
    const input = { us: { include: ['a'], junk: 1 }, eu: { include: [] } }
    const out = m.parse(input)
    check('record keeps every key', 'us' in out && 'eu' in out)
    check('record strips inside values', !('junk' in out.us))
    // The runtime's useDefaults does not fill defaults under a record value,
    // and parse() mirrors the runtime exactly rather than improving on it.
    check('record does not fill value defaults, same as the runtime', !('note' in out.us) && !('note' in out.eu))
    check('record leaves the input alone', input.us.junk === 1)
    const r = new Validator(schema).validate({ us: { include: ['a'] } })
    check('record parse equals runtime validate().data', JSON.stringify(m.parse({ us: { include: ['a'] } })) === JSON.stringify(r.data))
  }
}

// 17b. declared properties and a record part on the same node
{
  const schema = {
    type: 'object',
    properties: { version: { type: 'number' } },
    required: ['version'],
    additionalProperties: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] },
  }
  const m = compile(schema)
  check('mixed record gets parse', m && typeof m.parse === 'function')
  if (m && typeof m.parse === 'function') {
    const out = m.parse({ version: 1, flagA: { v: 2, x: 3 } })
    check('mixed record: declared key kept', out.version === 1)
    check('mixed record: extra key kept, value stripped', out.flagA && out.flagA.v === 2 && !('x' in out.flagA))
  }
}

// 17c. a record of records recurses
{
  const schema = {
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] },
    },
  }
  const m = compile(schema)
  check('record of records gets parse', m && typeof m.parse === 'function')
  if (m && typeof m.parse === 'function') {
    const out = m.parse({ a: { b: { v: 1, x: 2 } } })
    check('record of records strips at the leaf', out.a.b.v === 1 && !('x' in out.a.b))
  }
}

// 17d. the gateway shape: a $ref to a record, both passes composed
{
  const schema = {
    type: 'object',
    $defs: {
      match: {
        type: 'object',
        additionalProperties: { type: 'object', properties: { include: { type: 'array', items: { type: 'string' } } }, required: ['include'] },
      },
    },
    properties: { match: { $ref: '#/$defs/match' } },
    required: ['match'],
  }
  const m = compile(schema)
  check('ref to a record gets parse', m && typeof m.parse === 'function')
  if (m && typeof m.parse === 'function') {
    const out = m.parse({ match: { any: { include: ['x'], junk: 1 } }, extra: 2 })
    check('ref-record strips around and inside', !('extra' in out) && out.match.any.include[0] === 'x' && !('junk' in out.match.any))
  }
}

// 17e. additionalProperties: true stays declined, loudly: an unconstrained
// value can be anything, and this pass only copies what it can name.
{
  const warned = []
  const src = toStandaloneModule(new Validator({ type: 'object', properties: { a: { type: 'number' } }, additionalProperties: true }), {
    format: 'cjs', parse: true, onWarning: (w, meta) => warned.push([w, meta]),
  })
  check('AP true gets no parse', !/_ataParse/.test(src))
  check('AP true decline warns', warned.length === 1)
}

// 17f. warnings are distinguishable: a parse decline says so in meta.kind,
// so a build that asked for parse does not mistake it for degraded errors.
{
  const kinds = []
  toStandaloneModule(new Validator({
    type: 'object',
    $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
    properties: { root: { $ref: '#/$defs/node' } },
  }), { format: 'cjs', parse: true, onWarning: (w, meta) => kinds.push(meta && meta.kind) })
  check('parse decline carries kind parse', kinds.length === 1 && kinds[0] === 'parse')
}

// 17. parse through an inlined ref stays exactly as strict as validate
{
  const schema = {
    type: 'object',
    $defs: { item: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] } },
    properties: { it: { $ref: '#/$defs/item' } },
    required: ['it'],
  }
  const m = compile(schema)
  if (m && typeof m.parse === 'function') {
    let threw = false
    try { m.parse({ it: {} }) } catch (e) { threw = e.name === 'AtaValidationError' }
    check('inlined ref parse still throws on invalid', threw)
    check('inlined ref verdict agrees with runtime', m.isValid({ it: { v: 1 } }) === true && m.isValid({ it: {} }) === false)
  } else {
    check('inlined ref parse exists for strictness test', false)
  }
}

// 18. prototype-named keys and parse(). A schema that declares a property
// with an Object.prototype name (constructor, toString) routes to the
// interpreter and gets no standalone module at all, so those names cannot
// reach the emitted clone; the emitter still writes them defensively with
// computed keys, Object.hasOwn and defineProperty in case that routing ever
// narrows. What IS reachable is a record: the keys come from the input, and
// JSON.parse can hand the loop an own key named "__proto__". Assignment
// would rewrite the output's prototype instead of creating the property.
{
  const named = toStandaloneModule(
    new Validator({ type: 'object', properties: { a: { type: 'number' }, toString: { type: 'string' } }, required: ['a'] }),
    { format: 'cjs', parse: true },
  )
  check('a prototype-named property routes off codegen, no module', named === null)

  const schema = {
    type: 'object',
    additionalProperties: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] },
  }
  const m = compile(schema)
  if (m && typeof m.parse === 'function') {
    const input = JSON.parse('{"__proto__": {"v": 1, "junk": 2}, "plain": {"v": 3}}')
    const out = m.parse(input)
    check('record keeps an own __proto__ key as an own key',
      Object.hasOwn(out, '__proto__') && out['__proto__'].v === 1 && !('junk' in out['__proto__']))
    check('record output prototype is untouched', Object.getPrototypeOf(out) === Object.prototype)
    check('object prototype is untouched', !Object.hasOwn(Object.prototype, 'v'))
  } else {
    check('record module exists for the __proto__ input test', false)
  }
}

fs.rmSync(dir, { recursive: true, force: true })
if (failed) process.exit(1)
console.log('aot parse: strips, defaults, composed shapes under the subset proof; declines where it cannot prove the copy')
