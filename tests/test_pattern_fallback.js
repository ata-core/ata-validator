'use strict'

// The patternFallback option (issue #131). A pattern the linear-time engine
// cannot represent (a backreference, a lookaround, \B, \k, a repeat past the
// instruction budget, a property escape the plain check does not take) runs on
// the platform RegExp by default. With 'reject' the validator refuses the
// schema when it is built; with a function, the function's matcher answers
// for such a pattern on every path that runs one, and nothing hands it to the
// RegExp. Each path is held to that here, since a path that ignored the option
// would accept quietly and nothing else would notice.
//
// Run again in a child process with code generation blocked and without the
// native addon, where the interpreted engine is the only engine.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..')
const CHILD = process.env.ATA_PF_CHILD === '1'
const ata = require(ROOT)
const { Validator } = ata

let passed = 0
const failures = []
function check (name, fn) {
  try { fn(); passed++ } catch (e) { failures.push(name + ': ' + (e && e.stack || e)) }
}
async function checkAsync (name, fn) {
  try { await fn(); passed++ } catch (e) { failures.push(name + ': ' + (e && e.stack || e)) }
}

const codegen = new Validator({ type: 'string', pattern: '^[a-z]+$' }, {}).engine() === 'codegen'
let native = null
try { native = CHILD ? null : require(path.join(ROOT, 'lib', 'native-load.js'))() } catch { native = null }

// Patterns outside the engine, one of each kind the brief names, with a
// string each one matches on the platform RegExp and one it does not.
const BACKREF = '^(a)\\1$'
const LOOKAHEAD = '^x(?=y)'
const NEG_LOOKAHEAD = '^(?!bad)'
const NON_BOUNDARY = 'a\\B'
const NAMED_BACKREF = '^(?<q>a)\\k<q>$'
const BUDGET = '^((a|b){1000}){100}$'
const PROPERTY = '^(\\p{L}+)+$'
const FALLBACKS = [BACKREF, LOOKAHEAD, NEG_LOOKAHEAD, NON_BOUNDARY, NAMED_BACKREF, BUDGET, PROPERTY]

// A matcher that is plainly not the pattern: it accepts exactly the string
// "magic", so an answer that follows the RegExp instead is visible.
function magic (log) {
  return (src, flags) => {
    if (log) log.push([src, flags])
    return { test: (s) => s === 'magic' }
  }
}

const S_PATTERN = { type: 'object', properties: { a: { type: 'string', pattern: BACKREF } } }
const S_PATTERN_PROPS = { type: 'object', patternProperties: { [LOOKAHEAD]: { type: 'number' } } }
const S_PROPERTY_NAMES = { type: 'object', propertyNames: { pattern: NEG_LOOKAHEAD } }

// --- the option value ---

check('unknown values are refused', () => {
  for (const bad of ['Reject', 'off', '', 1, true, null, {}, []]) {
    assert.throws(() => new Validator({ type: 'string' }, { patternFallback: bad }), TypeError, JSON.stringify(bad))
  }
})
check("'platform' and undefined change nothing", () => {
  for (const opt of [{}, { patternFallback: 'platform' }, { patternFallback: undefined }]) {
    const v = new Validator(S_PATTERN, opt)
    assert.strictEqual(v.validate({ a: 'aa' }).valid, true)
    assert.strictEqual(v.validate({ a: 'ab' }).valid, false)
    assert.strictEqual(v._patternHook, undefined)
  }
})

// --- 'reject' ---

function rejects (schema, source, where, opts) {
  let err = null
  try { new Validator(schema, { ...opts, patternFallback: 'reject' }) } catch (e) { err = e }
  assert.ok(err, 'expected a refusal for ' + JSON.stringify(source))
  assert.ok(err.message.includes(JSON.stringify(source)), err.message)
  if (where) assert.ok(err.message.includes(where), err.message + ' should name ' + where)
}

check("'reject' refuses each kind of pattern outside the engine", () => {
  for (const p of FALLBACKS) rejects({ type: 'string', pattern: p }, p, '#/pattern')
})
check("'reject' refuses pattern, patternProperties and propertyNames, naming the location", () => {
  rejects(S_PATTERN, BACKREF, '#/properties/a/pattern')
  rejects(S_PATTERN_PROPS, LOOKAHEAD, '#/patternProperties/' + LOOKAHEAD)
  rejects(S_PROPERTY_NAMES, NEG_LOOKAHEAD, '#/propertyNames/pattern')
  rejects({ patternProperties: { 'a/b(?=c)': {} } }, 'a/b(?=c)', '#/patternProperties/a~1b(?=c)')
})
check("'reject' finds patterns wherever a reference can reach", () => {
  rejects({ $defs: { x: { pattern: BACKREF } }, $ref: '#/$defs/x' }, BACKREF, '#/$defs/x/pattern')
  rejects({ $schema: 'http://json-schema.org/draft-07/schema#', definitions: { x: { pattern: BACKREF } } }, BACKREF, '#/definitions/x/pattern')
  rejects({ $schema: 'http://json-schema.org/draft-07/schema#', dependencies: { a: { properties: { b: { pattern: BACKREF } } } } }, BACKREF, '#/dependencies/a/properties/b/pattern')
  rejects({ $schema: 'http://json-schema.org/draft-07/schema#', items: [{ pattern: BACKREF }] }, BACKREF, '#/items/0/pattern')
  rejects({ propertyDependencies: { k: { v: { pattern: BACKREF } } } }, BACKREF, '#/propertyDependencies/k/v/pattern')
  // A pointer into a place no keyword declares a subschema: the scan reads
  // every object, so a `default` a reference lands on counts.
  rejects({ $ref: '#/default', default: { pattern: BACKREF } }, BACKREF, '#/default/pattern')
  rejects({ $ref: '#/x-ext/s', 'x-ext': { s: { pattern: BACKREF } } }, BACKREF, '#/x-ext/s/pattern')
  rejects({ anyOf: [{ not: { if: { pattern: 'a' }, then: { pattern: BACKREF } } }] }, BACKREF, '#/anyOf/0/not/then/pattern')
})
check("'reject' scans the documents registered beside the root", () => {
  const ext = { $id: 'https://example.com/ext.json', type: 'string', pattern: BACKREF }
  rejects({ $ref: 'https://example.com/ext.json' }, BACKREF, 'https://example.com/ext.json#/pattern', { schemas: [ext] })
  const v = new Validator({ $ref: 'https://example.com/ext.json' }, { patternFallback: 'reject' })
  assert.throws(() => v.addSchema(ext), (e) => e.message.includes(JSON.stringify(BACKREF)))
})
check("'reject' refuses a schema given as text", () => {
  rejects(JSON.stringify(S_PATTERN), BACKREF, '#/properties/a/pattern')
})
check("'reject' leaves linear patterns alone, on the same engine and with the same answers", () => {
  const linear = {
    type: 'object',
    properties: {
      a: { type: 'string', pattern: '^[a-z]+$' },
      b: { type: 'string', pattern: '^\\d{3}-\\d{4}$' },
      c: { type: 'string', pattern: '(ab|cd)+e' },
      d: { type: 'string', pattern: '^(a+)+$' },
      e: { type: 'string', pattern: '^[\\w.-]+@[\\w-]+\\.[a-z]{2,}$' },
    },
    patternProperties: { '^x-': { type: 'string' } },
    propertyNames: { pattern: '^[a-z-]+$' },
  }
  const plain = new Validator(linear, {})
  const strict = new Validator(linear, { patternFallback: 'reject' })
  assert.strictEqual(strict.engine(), plain.engine())
  const docs = [
    { a: 'ab', b: '123-4567', c: 'xabcde', d: 'aaa', e: 'a.b@c-d.io', 'x-y': 'z' },
    { a: 'A' }, { b: '1234567' }, { c: 'abe' }, { c: 'ae' }, { d: 'aab' }, { e: 'a@b' }, { 'x-y': 1 }, { B: 1 },
  ]
  for (const d of docs) {
    assert.strictEqual(strict.validate(d).valid, plain.validate(d).valid, JSON.stringify(d))
    assert.strictEqual(strict.isValidObject(d), plain.isValidObject(d), JSON.stringify(d))
    assert.strictEqual(strict.isValidJSON(JSON.stringify(d)), plain.isValidJSON(JSON.stringify(d)), JSON.stringify(d))
  }
})
check("'reject' refuses the vendored meta-schemas nothing", () => {
  const { METASCHEMAS } = require(path.join(ROOT, 'lib', 'metaschemas'))
  for (const [id, meta] of METASCHEMAS) new Validator(meta, { patternFallback: 'reject' }) || id
  const v = new Validator({ $ref: 'https://json-schema.org/draft/2020-12/schema' }, { patternFallback: 'reject' })
  assert.strictEqual(v.validate({ type: 'string' }).valid, true)
  assert.strictEqual(v.validate({ type: 1 }).valid, false)
})
check("'reject' refuses a pattern a custom keyword's macro writes, when it compiles", () => {
  const v = new Validator({ type: 'string', twice: true }, {
    patternFallback: 'reject',
    keywords: { twice: { macro: () => ({ pattern: BACKREF }) } },
  })
  assert.throws(() => v.validate('aa'), (e) => e.message.includes(JSON.stringify(BACKREF)))
  for (const call of [(w) => w.isValidObject('aa'), (w) => w.isValidJSON('"aa"'), (w) => w.validateJSON('"aa"')]) {
    const w = new Validator({ type: 'string', twice: true }, { patternFallback: 'reject', keywords: { twice: { macro: () => ({ pattern: BACKREF }) } } })
    assert.throws(() => call(w), (e) => e.message.includes(JSON.stringify(BACKREF)))
  }
})

// --- a function ---

check('the function is called once per pattern, at construction, with source and flags', () => {
  const log = []
  const schema = {
    type: 'object',
    properties: { a: { type: 'string', pattern: BACKREF }, b: { type: 'string', pattern: BACKREF }, c: { type: 'string', pattern: '^[a-z]+$' }, d: { pattern: '^[\\w-.]+(?=x)' } },
    patternProperties: { [LOOKAHEAD]: {} },
    propertyNames: { pattern: NEG_LOOKAHEAD },
  }
  const v = new Validator(schema, { patternFallback: magic(log) })
  // No linear pattern reaches it; a pattern twice is asked about once; the
  // flags are those the platform RegExp would have used (`[\w-.]` is valid
  // only without the u flag).
  assert.deepStrictEqual(log, [[BACKREF, 'u'], ['^[\\w-.]+(?=x)', ''], [LOOKAHEAD, 'u'], [NEG_LOOKAHEAD, 'u']])
  for (let i = 0; i < 3; i++) { v.validate({ a: 'aa' }); v.isValidObject({ a: 'magic' }); v.validateJSON('{"b":"x"}') }
  assert.strictEqual(log.length, 4)
})
check('the function decides for each kind of pattern outside the engine', () => {
  for (const p of FALLBACKS) {
    const v = new Validator({ type: 'string', pattern: p }, { patternFallback: magic() })
    assert.strictEqual(v.validate('magic').valid, true, p)
    assert.strictEqual(v.validate('aa').valid, false, p)
  }
})
check('a pattern the RegExp is proven to run in linear time is not fallback', () => {
  // A property escape and a repeat past the linear engine's budget, both
  // proven linear on the platform RegExp (lib/regex-linear.js).
  for (const p of ['^\\p{L}+$', '^\\p{Lu}\\p{Ll}*$', '^[\\p{L} .-]+$', '^a{70000}$']) {
    const log = []
    const strict = new Validator({ type: 'string', pattern: p }, { patternFallback: 'reject' })
    const fn = new Validator({ type: 'string', pattern: p }, { patternFallback: magic(log) })
    const plain = new Validator({ type: 'string', pattern: p }, {})
    for (const s of ['Émile', 'ab', 'a'.repeat(70000), 'x1', '']) {
      assert.strictEqual(strict.validate(s).valid, plain.validate(s).valid, p)
      assert.strictEqual(fn.isValidObject(s), plain.isValidObject(s), p)
    }
    assert.strictEqual(log.length, 0, p)
    assert.strictEqual(fn.engine(), plain.engine(), p)
  }
})
check('a linear pattern is not handed to the function', () => {
  const log = []
  const v = new Validator({ type: 'string', pattern: '^[a-z]+\\d?$' }, { patternFallback: magic(log) })
  assert.strictEqual(v.validate('ab1').valid, true)
  assert.strictEqual(log.length, 0)
})

// Every entry point, for each of the three keywords.
function allPaths (v) {
  return (doc) => {
    const text = JSON.stringify(doc)
    const answers = [
      v.validate(doc).valid,
      v.isValidObject(doc),
      v.validateJSON(text).valid,
      v.isValidJSON(text),
      v.isValid(Buffer.from(text)),
      v.countValid(Buffer.from(text + '\n' + text)) === 2,
      v.validateAndParse(text).valid,
    ]
    for (const a of answers) assert.strictEqual(a, answers[0], 'paths disagree on ' + text + ': ' + answers)
    return answers[0]
  }
}

check('pattern: every entry point asks the function', () => {
  const all = allPaths(new Validator(S_PATTERN, { patternFallback: magic() }))
  assert.strictEqual(all({ a: 'magic' }), true)
  assert.strictEqual(all({ a: 'aa' }), false)
})
check('patternProperties: every entry point asks the function', () => {
  const all = allPaths(new Validator(S_PATTERN_PROPS, { patternFallback: magic() }))
  assert.strictEqual(all({ magic: 'not a number' }), false)
  assert.strictEqual(all({ magic: 1 }), true)
  assert.strictEqual(all({ xy: 'not a number' }), true)
})
check('propertyNames: every entry point asks the function', () => {
  const all = allPaths(new Validator(S_PROPERTY_NAMES, { patternFallback: magic() }))
  assert.strictEqual(all({ magic: 1 }), true)
  assert.strictEqual(all({ good: 1 }), false)
})
check('\\B, which RE2 takes, is answered by the function on the buffer path too', () => {
  const v = new Validator({ type: 'string', pattern: NON_BOUNDARY }, { patternFallback: magic() })
  assert.strictEqual(v.isValid(Buffer.from('"aa"')), false)
  assert.strictEqual(v.isValid(Buffer.from('"magic"')), true)
  assert.strictEqual(v.isValidParallel(Buffer.from('"aa"\n"magic"')).join(), 'false,true')
  assert.strictEqual(v.batchIsValid([Buffer.from('"aa"'), Buffer.from('"magic"')]), 1)
  // A document past the simdjson threshold.
  const big = JSON.stringify('magic'.padEnd(20000, ' ').trim())
  assert.strictEqual(v.validateJSON(big).valid, true)
})
check('the errors name the pattern and come from the function', () => {
  const v = new Validator(S_PATTERN, { patternFallback: magic() })
  const r = v.validate({ a: 'aa' })
  assert.strictEqual(r.valid, false)
  assert.strictEqual(r.errors[0].keyword, 'pattern')
  assert.strictEqual(r.errors[0].instancePath, '/a')
  const pn = new Validator(S_PROPERTY_NAMES, { patternFallback: magic() }).validate({ good: 1 })
  assert.ok(pn.errors.some((e) => e.keyword === 'pattern' || e.keyword === 'propertyNames'), JSON.stringify(pn.errors))
  for (const opts of [{ abortEarly: true }, { verbose: true }, { richErrors: false }]) {
    const w = new Validator(S_PATTERN, { ...opts, patternFallback: magic() })
    assert.strictEqual(w.validate({ a: 'magic' }).valid, true, JSON.stringify(opts))
    assert.strictEqual(w.validate({ a: 'aa' }).valid, false, JSON.stringify(opts))
  }
})
check('removeAdditional keeps the keys the function matches, removes the rest', () => {
  const schema = { type: 'object', properties: { id: {} }, patternProperties: { [LOOKAHEAD]: {} }, additionalProperties: false }
  const v = new Validator(schema, { removeAdditional: true, patternFallback: magic() })
  const doc = { id: 1, magic: 2, xy: 3 }
  assert.strictEqual(v.validate(doc).valid, true)
  assert.deepStrictEqual(doc, { id: 1, magic: 2 })
  const doc2 = { id: 1, magic: 2, xy: 3 }
  assert.strictEqual(v.isValidObject(doc2), true)
  assert.deepStrictEqual(doc2, { id: 1, magic: 2 })
})
check('defaults under patternProperties follow the function', () => {
  const schema = { type: 'object', patternProperties: { [LOOKAHEAD]: { type: 'object', properties: { d: { default: 7 } } } } }
  const v = new Validator(schema, { patternFallback: magic() })
  const doc = { magic: {}, xy: {} }
  assert.strictEqual(v.validate(doc).valid, true)
  assert.deepStrictEqual(doc, { magic: { d: 7 }, xy: {} })
})
check('coerceTypes with a pattern the function answers', () => {
  const v = new Validator({ type: 'object', properties: { a: { type: 'string', pattern: BACKREF } } }, { coerceTypes: true, patternFallback: magic() })
  assert.strictEqual(v.validate({ a: 'magic' }).valid, true)
  assert.strictEqual(v.validate({ a: 'aa' }).valid, false)
})
check('a pattern in a registered document, by option and by addSchema, asks the function', () => {
  const ext = { $id: 'https://example.com/p.json', type: 'string', pattern: BACKREF }
  const log = []
  const a = new Validator({ $ref: 'https://example.com/p.json' }, { schemas: [ext], patternFallback: magic(log) })
  assert.strictEqual(a.validate('magic').valid, true)
  assert.strictEqual(a.validate('aa').valid, false)
  const b = new Validator({ $ref: 'https://example.com/p.json' }, { patternFallback: magic(log) })
  b.addSchema(ext)
  assert.strictEqual(b.isValidObject('magic'), true)
  assert.strictEqual(b.isValidObject('aa'), false)
  assert.strictEqual(b.isValid(Buffer.from('"aa"')), false)
  assert.strictEqual(log.length, 2)
})
check('a pattern a macro writes is resolved through the function when it compiles', () => {
  const log = []
  const v = new Validator({ type: 'string', twice: true }, {
    patternFallback: magic(log),
    keywords: { twice: { macro: () => ({ pattern: BACKREF }) } },
  })
  assert.strictEqual(v.validate('magic').valid, true)
  assert.strictEqual(v.validate('aa').valid, false)
  assert.strictEqual(v.isValidObject('aa'), false)
  assert.strictEqual(v.isValidJSON('"magic"'), true)
  assert.strictEqual(v.validateJSON('"aa"').valid, false)
  assert.strictEqual(log.length, 1)
})
check("what 'reject' lets through runs on the linear engine or a RegExp shown linear, on every path (official suite patterns)", () => {
  const { _compilePattern } = require(path.join(ROOT, 'lib', 'interpreter-core'))
  const { _internal } = require(path.join(ROOT, 'lib', 'js-compiler'))
  const { nativeIsLinear } = require(path.join(ROOT, 'lib', 'regex-linear'))
  const { safeKeyMatcher } = require(path.join(ROOT, 'lib', 'defaults'))
  const OUT = {}
  const outside = (s) => { try { return _compilePattern(s, (x, re) => nativeIsLinear(x) ? re : OUT) === OUT } catch { return false } }
  // The interpreted engine without the option: the linear engine, or a
  // RegExp the interpreter or lib/regex-linear.js shows linear.
  const interpOk = (s) => { const m = _compilePattern(s); return m.__ataSafe === true || nativeIsLinear(s) }
  const pats = new Set()
  const walk = (n) => {
    if (n === null || typeof n !== 'object') return
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (k === 'pattern' && typeof v === 'string') pats.add(v)
      if (k === 'patternProperties' && v && typeof v === 'object') for (const p of Object.keys(v)) pats.add(p)
      walk(v)
    }
  }
  const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : [])
  for (const f of files(path.join(__dirname, 'suite', 'tests'))) walk(JSON.parse(fs.readFileSync(f, 'utf8')))
  let survivors = 0, out = 0
  for (const p of pats) {
    try { new RegExp(p, 'u') } catch { try { new RegExp(p) } catch { continue } }
    if (outside(p)) { out++; continue }
    survivors++
    assert.ok(interpOk(p), p)
    // Generated code: the linear engine, a RegExp shown linear, or declined.
    assert.ok(_internal.useSafeEngine(p) || nativeIsLinear(p) || !_internal.patternEngineOk(p), p)
    // The defaults pass's key matcher.
    const m = safeKeyMatcher(p)
    assert.ok((m && m.__ataSafe) || nativeIsLinear(p), p)
  }
  assert.ok(survivors >= 30 && out >= 2, survivors + ' ' + out)
})
check('the matcher contract: an object with test, a boolean answer, errors propagate', () => {
  for (const bad of [undefined, null, 1, 'x', {}, { test: 1 }]) {
    assert.throws(() => new Validator(S_PATTERN, { patternFallback: () => bad }), TypeError, String(bad))
  }
  // A RegExp is an object with a test function, so it is accepted as one.
  const re = new Validator(S_PATTERN, { patternFallback: (s, f) => new RegExp(s, f) })
  assert.strictEqual(re.validate({ a: 'aa' }).valid, true)
  assert.strictEqual(re.validate({ a: 'ab' }).valid, false)
  const boom = new Error('boom')
  assert.throws(() => new Validator(S_PATTERN, { patternFallback: () => { throw boom } }), (e) => e === boom)
  const thrower = new Validator(S_PATTERN, { patternFallback: () => ({ test () { throw boom } }) })
  assert.throws(() => thrower.validate({ a: 'x' }), (e) => e === boom)
  assert.throws(() => thrower.isValidObject({ a: 'x' }), (e) => e === boom)
  for (const answer of [1, 0, 'true', null, undefined, {}]) {
    const v = new Validator(S_PATTERN, { patternFallback: () => ({ test: () => answer }) })
    assert.throws(() => v.validate({ a: 'x' }), TypeError, String(answer))
    assert.throws(() => v.isValidObject({ a: 'x' }), TypeError, String(answer))
    assert.throws(() => v.isValid(Buffer.from('{"a":"x"}')), TypeError, String(answer))
  }
})
check('a function that matches nothing outside the engine leaves the fast engines in place', () => {
  const log = []
  const v = new Validator({ type: 'string', pattern: '^[a-z]+$' }, { patternFallback: magic(log) })
  assert.strictEqual(v.engine(), codegen ? 'codegen' : 'interpreter')
  assert.strictEqual(log.length, 0)
})
check('a validator whose function holds a matcher answers on the interpreted engine', () => {
  assert.strictEqual(new Validator(S_PATTERN, { patternFallback: magic() }).engine(), 'interpreter')
})

// --- caches ---

check('validators of the same schema with different modes do not share answers', () => {
  const schema = { type: 'object', properties: { a: { type: 'string', pattern: BACKREF } }, patternProperties: { [LOOKAHEAD]: { type: 'number' } } }
  const docs = [{ a: 'aa' }, { a: 'magic' }, { a: 'other' }, { xy: 'q' }, { magic: 'q' }]
  const platform = () => docs.map((d) => [new Validator(schema, {}).validate(d).valid])
  const expectPlatform = [[true], [false], [false], [false], [true]]
  const expectMagic = [[false], [true], [false], [true], [false]]
  // The default validator first, so every cache holds its compile.
  const plain = new Validator(schema)
  for (const d of docs) { plain.validate(d); plain.isValidObject(d); plain.validateJSON(JSON.stringify(d)) }
  for (let round = 0; round < 3; round++) {
    const m = new Validator(schema, { patternFallback: magic() })
    assert.deepStrictEqual(docs.map((d) => [m.validate(d).valid]), expectMagic, 'round ' + round)
    assert.deepStrictEqual(docs.map((d) => [m.isValidObject(d)]), expectMagic, 'round ' + round)
    assert.deepStrictEqual(docs.map((d) => [m.isValidJSON(JSON.stringify(d))]), expectMagic, 'round ' + round)
    assert.throws(() => new Validator(schema, { patternFallback: 'reject' }))
    assert.deepStrictEqual(platform(), expectPlatform, 'round ' + round)
    // The schema object without options hands back the instance already
    // built for it, which must be the default one.
    assert.strictEqual(new Validator(schema), plain)
    assert.strictEqual(new Validator(schema).validate({ a: 'aa' }).valid, true)
    assert.strictEqual(ata.validate(schema, { a: 'aa' }).valid, true)
    assert.strictEqual(ata.compile(schema)({ a: 'aa' }).valid, true)
  }
})
check('two functions on the same schema each answer for their own validator', () => {
  const schema = { type: 'string', pattern: BACKREF }
  const only = (word) => () => ({ test: (s) => s === word })
  const one = new Validator(schema, { patternFallback: only('one') })
  const two = new Validator(schema, { patternFallback: only('two') })
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(one.validate('one').valid, true)
    assert.strictEqual(one.validate('two').valid, false)
    assert.strictEqual(two.validate('two').valid, true)
    assert.strictEqual(two.isValidObject('one'), false)
    assert.strictEqual(two.isValid(Buffer.from('"one"')), false)
  }
  const s = JSON.stringify(schema)
  assert.strictEqual(new Validator(s, { patternFallback: only('x') }).validate('x').valid, true)
  assert.strictEqual(new Validator(s, {}).validate('x').valid, false)
})
check('the function a validator was built with is the one it keeps', () => {
  const schema = { type: 'string', pattern: BACKREF }
  const opts = { patternFallback: () => ({ test: (s) => s === 'first' }) }
  const v = new Validator(schema, opts)
  opts.patternFallback = () => ({ test: () => true })
  assert.strictEqual(v.validate('first').valid, true)
  assert.strictEqual(v.validate('other').valid, false)
})

// --- modules built ahead of time ---

check('toStandaloneModule, the compact modules and the bundles refuse a function', () => {
  const build = require(path.join(ROOT, 'build.js'))
  const fn = magic()
  assert.throws(() => build.toStandaloneModule(S_PATTERN, { patternFallback: fn }), /function cannot be carried/)
  const linear = { type: 'string', pattern: '^[a-z]+$' }
  assert.throws(() => build.toStandaloneModule(linear, { patternFallback: fn }), /function cannot be carried/)
  assert.throws(() => build.toStandaloneModule(new Validator(linear, { patternFallback: fn })), /function cannot be carried/)
  if (codegen) {
    const aot = require(path.join(ROOT, 'lib', 'aot.js'))
    for (const name of ['toCompactModule', 'toSchemaModule']) {
      if (typeof aot[name] === 'function') assert.throws(() => aot[name](new Validator(linear, { patternFallback: fn }), { format: 'esm', errorRuntime: 'ata-validator/error-runtime', runtime: 'ata-validator/error-runtime' }), /function cannot be carried/, name)
    }
    assert.throws(() => Validator.bundle([linear], { patternFallback: fn }), /function cannot be carried/)
    assert.throws(() => Validator.bundleStandalone([linear], { patternFallback: fn }), /function cannot be carried/)
    assert.throws(() => Validator.bundleCompact([linear], { patternFallback: fn }), /function cannot be carried/)
  }
})
check("toStandaloneModule and the bundles under 'reject'", () => {
  if (!codegen) return
  const build = require(path.join(ROOT, 'build.js'))
  assert.throws(() => build.toStandaloneModule(S_PATTERN, { patternFallback: 'reject' }), (e) => e.message.includes(JSON.stringify(BACKREF)))
  assert.throws(() => Validator.bundleStandalone([S_PATTERN], { patternFallback: 'reject' }), (e) => e.message.includes(JSON.stringify(BACKREF)))
  assert.throws(() => Validator.bundleCompact([S_PATTERN], { patternFallback: 'reject' }), (e) => e.message.includes(JSON.stringify(BACKREF)))
  const linear = { type: 'string', pattern: '^[a-z]+$' }
  const src = build.toStandaloneModule(linear, { patternFallback: 'reject', format: 'cjs' })
  assert.ok(typeof src === 'string' && src.length > 0)
  assert.ok(Validator.bundleStandalone([linear], { patternFallback: 'reject' }).length > 0)
})
check('fromStandalone refuses a function, and a fallback pattern under reject', () => {
  if (!codegen) return
  const mod = { boolFn: () => true }
  assert.throws(() => Validator.fromStandalone(mod, S_PATTERN, { patternFallback: magic() }), /function cannot be carried/)
  assert.throws(() => Validator.fromStandalone(mod, S_PATTERN, { patternFallback: 'reject' }), (e) => e.message.includes(JSON.stringify(BACKREF)))
  assert.throws(() => Validator.fromStandalone(mod, S_PATTERN, { patternFallback: 'nope' }), TypeError)
})
check('a bundler plugin cannot replace a validator built with the option', () => {
  const build = require(path.join(ROOT, 'build.js'))
  assert.ok(!build.compiledOptions.includes('patternFallback'))
  const { fromCompiled } = require(path.join(ROOT, 'lib', 'compiled.js'))
  assert.throws(() => fromCompiled({}, S_PATTERN, { patternFallback: 'reject' }), /patternFallback/)
})

async function buildChecks () {
  if (!codegen) return
  const build = require(path.join(ROOT, 'build.js'))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-pf-'))
  try {
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(S_PATTERN_PROPS))
    fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify({ type: 'string', pattern: '^[a-z]+$' }))
    const cacheFile = path.join(dir, '.cache.json')
    const glob = path.join(dir, '*.json')
    await checkAsync('build() without the option compiles both', async () => {
      const r = await build.build({ globs: [glob], cacheFile, types: false })
      assert.strictEqual(r.failed.length, 0, JSON.stringify(r.failed))
      assert.strictEqual(r.compiled.length, 2)
    })
    await checkAsync("build() under 'reject' fails the input, past a cache written without it", async () => {
      const r = await build.build({ globs: [glob], cacheFile, types: false, patternFallback: 'reject' })
      assert.strictEqual(r.failed.length, 1, JSON.stringify(r))
      assert.ok(r.failed[0].input.endsWith('bad.json'))
      assert.ok(r.failed[0].error.includes(JSON.stringify(LOOKAHEAD)), r.failed[0].error)
      assert.ok(r.failed[0].error.includes('#/patternProperties/'), r.failed[0].error)
      const again = await build.build({ globs: [glob], cacheFile, types: false, patternFallback: 'reject' })
      assert.strictEqual(again.failed.length, 1, 'a second run must not take the module from the cache')
    })
    await checkAsync('build() refuses a function and an unknown value', async () => {
      await assert.rejects(build.build({ globs: [glob], types: false, patternFallback: magic() }), /function cannot be carried/)
      await assert.rejects(build.build({ globs: [glob], types: false, patternFallback: 'nope' }), /patternFallback must be/)
    })
    await checkAsync('the CLI: --pattern-fallback reject', async () => {
      const cli = path.join(ROOT, 'bin', 'ata.js')
      const b = spawnSync(process.execPath, [cli, 'build', glob, '--pattern-fallback', 'reject', '--no-types'], { encoding: 'utf8' })
      assert.notStrictEqual(b.status, 0, b.stdout + b.stderr)
      assert.ok((b.stdout + b.stderr).includes('outside the linear-time engine'), b.stdout + b.stderr)
      const out = path.join(dir, 'out.mjs')
      const c = spawnSync(process.execPath, [cli, 'compile', path.join(dir, 'bad.json'), '-o', out, '--pattern-fallback=reject', '--no-types'], { encoding: 'utf8' })
      assert.notStrictEqual(c.status, 0, c.stdout + c.stderr)
      assert.ok(!fs.existsSync(out))
      const g = spawnSync(process.execPath, [cli, 'compile', path.join(dir, 'good.json'), '-o', out, '--pattern-fallback', 'reject', '--no-types'], { encoding: 'utf8' })
      assert.strictEqual(g.status, 0, g.stdout + g.stderr)
      const n = spawnSync(process.execPath, [cli, 'compile', path.join(dir, 'good.json'), '-o', out, '--pattern-fallback', 'sometimes', '--no-types'], { encoding: 'utf8' })
      assert.notStrictEqual(n.status, 0)
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Each entry in a process of its own: in this one, index.js has already
// registered the option on the shared core, and every entry would pass.
function inChild (code, type) {
  const r = spawnSync(process.execPath, type === 'module' ? ['--input-type=module', '-e', code] : ['-e', code], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
  return (r.stdout + r.stderr).trim().split('\n').filter((l) => !/Warning|trace-warnings/.test(l)).join('\n')
}
const PROBE = `
  const S = ${JSON.stringify(S_PATTERN)}
  const out = []
  try { new V(S, { patternFallback: () => ({ test: (s) => s === 'magic' }) }); out.push('built') } catch (e) { out.push(e.constructor.name + ': ' + e.message) }
  out.push(String(new V(S, { patternFallback: 'platform' }).validate({ a: 'aa' }).valid))
  if (typeof ADD === 'function') { await ADD() }
  const v = new V(S, { patternFallback: () => ({ test: (s) => s === 'magic' }) })
  out.push(String(v.validate({ a: 'magic' }).valid), String(v.isValidObject({ a: 'aa' })))
  let rej = 'no'; try { new V(S, { patternFallback: 'reject' }) } catch (e) { rej = e.message.includes('outside the linear-time engine') ? 'rejected' : e.message }
  out.push(rej)
  console.log(out.join('|'))`
const REFUSED = "TypeError: patternFallback needs import 'ata-validator/pattern-fallback'|true|true|false|rejected"
const HONOURED = 'built|true|true|false|rejected'
const cjs = (entry, add) => inChild(`(async () => { const V = require(${JSON.stringify(path.join(ROOT, entry))}).Validator; const ADD = ${add ? `async () => require(${JSON.stringify(path.join(ROOT, 'pattern-fallback.js'))})` : 'null'}; ${PROBE} })()`)
// import() takes a URL: a Windows path such as d:\a\... is read as a scheme.
const esm = (entry, add) => inChild(`const { Validator: V } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, entry)).href)}); const ADD = ${add ? `async () => import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'pattern-fallback.mjs')).href)})` : 'null'}; ${PROBE}`, 'module')

check('the Node entries have the option by themselves', () => {
  assert.strictEqual(cjs('index.js', false), HONOURED)
  assert.strictEqual(esm('index.mjs', false), HONOURED)
  assert.strictEqual(esm('index.bundle.mjs', false), HONOURED)
})
check('the entries for pages and Workers refuse the option loudly until ata-validator/pattern-fallback is imported', () => {
  // The first answer is from before the import: refused, while 'platform'
  // still builds. The rest are from after it.
  assert.strictEqual(cjs('lite.js', true), REFUSED)
  assert.strictEqual(cjs('index.edge.js', true), REFUSED)
  assert.strictEqual(esm('lite.mjs', true), REFUSED)
  assert.strictEqual(esm('index.edge.mjs', true), REFUSED)
  assert.strictEqual(esm('index.browser.mjs', true), REFUSED)
})
check('ata-validator/pattern-fallback is exported and kept by bundlers', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.deepStrictEqual(pkg.exports['./pattern-fallback'], { types: './pattern-fallback.d.ts', import: './pattern-fallback.mjs', require: './pattern-fallback.js' })
  for (const f of ['./pattern-fallback.js', './pattern-fallback.mjs']) assert.ok(pkg.sideEffects.includes(f), f)
  let esbuild = null
  try { esbuild = require('esbuild') } catch {}
  if (esbuild === null) return
  // Bundled for a page and for a Worker, the import keeps the option in the
  // bundle; without it the bundle carries none of it.
  const probe = path.join(ROOT, 'tests', '.pattern-fallback-probe.mjs')
  try {
    for (const [conditions, platform] of [[['browser'], 'browser'], [['workerd', 'worker', 'browser'], 'neutral']]) {
      for (const add of [true, false]) {
        fs.writeFileSync(probe, (add ? "import 'ata-validator/pattern-fallback'\n" : '') + "import { Validator } from 'ata-validator'\nglobalThis.V = Validator\n")
        const out = esbuild.buildSync({ entryPoints: [probe], bundle: true, minify: true, format: 'esm', platform, conditions, mainFields: ['browser', 'module', 'main'], write: false, logLevel: 'silent' }).outputFiles[0].text
        assert.strictEqual(out.includes('outside the linear-time engine'), add, conditions.join() + (add ? ' with' : ' without') + ' the import')
      }
    }
  } finally {
    fs.rmSync(probe, { force: true })
  }
})

;(async () => {
  await buildChecks()
  if (!CHILD) {
    // The same file with code generation blocked and no addon.
    const r = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', __filename], {
      env: { ...process.env, ATA_PF_CHILD: '1', ATA_NO_NATIVE: '1' }, encoding: 'utf8',
    })
    if (r.status !== 0) failures.push('code generation blocked:\n' + r.stdout + r.stderr)
    else process.stdout.write(r.stdout.replace(/^ok: /m, 'ok (code generation blocked): '))
  }
  if (failures.length > 0) {
    for (const f of failures) console.error('FAIL ' + f)
    process.exit(1)
  }
  console.log(`ok: patternFallback, ${passed} checks${codegen ? '' : ' (interpreted engine only)'}${native ? ', native addon loaded' : ''}`)
})()
