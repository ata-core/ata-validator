'use strict'

// The patternFallback feature of the 2.0 Validator
// (ata-validator/features/patternFallback, lib/features/patternFallback.js,
// lib/pattern-fallback.js). A pattern the linear-time engine cannot represent
// (a backreference, a lookaround, \B, \k, a repeat past the instruction
// budget, a property escape the platform RegExp is not shown to run in linear
// time) runs on the platform RegExp by default. With 'reject' the validator
// refuses the schema at its first use; with a function, the function's
// matcher answers for such a pattern on every path that runs one, and nothing
// hands it to the RegExp. Each path is held to that here, since a path that
// ignored the option would accept quietly and nothing else would notice.
//
// Registration belongs to a module, and the browser and edge entries share
// one (lib/validator-full.js), so each entry is checked in a process of its
// own: the plugin's core (index.v2.core.mjs) with its features registered,
// the browser entry and the edge entry, whose verdict core keeps compiled
// patterns in a table the whole process shares. A fourth process per entry
// sets the option without registering the feature, where the constructor
// refuses it as any unknown option. ata-validator/ir is
// checked in this one. The children run with this process's flags, so under
// tests/test_no_eval.js every entry is checked with code generation blocked.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const KIND = process.env.ATA_PF2_KIND || ''
const ENTRY = { core: 'index.v2.core.mjs', browser: 'index.v2.browser.mjs', edge: 'index.v2.edge.mjs' }
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href)

let passed = 0
const failures = []
function check (name, fn) {
  try { fn(); passed++ } catch (e) { failures.push(name + ': ' + (e && e.stack || e)) }
}
async function checkAsync (name, fn) {
  try { await fn(); passed++ } catch (e) { failures.push(name + ': ' + (e && e.stack || e)) }
}
function done (label) {
  if (failures.length > 0) {
    for (const f of failures) console.error('FAIL ' + label + ' ' + f)
    process.exit(1)
  }
}

// Patterns outside the engine, one of each kind, with a matcher below that
// is plainly not the pattern.
const BACKREF = '^(a)\\1$'
const LOOKAHEAD = '^x(?=y)'
const NEG_LOOKAHEAD = '^(?!bad)'
const NON_BOUNDARY = 'a\\B'
const NAMED_BACKREF = '^(?<q>a)\\k<q>$'
const BUDGET = '^((a|b){1000}){100}$'
const PROPERTY = '^(\\p{L}+)+$'
const FALLBACKS = [BACKREF, LOOKAHEAD, NEG_LOOKAHEAD, NON_BOUNDARY, NAMED_BACKREF, BUDGET, PROPERTY]
const OUTSIDE = 'outside the linear-time engine'
const UNKNOWN = 'ata2: option patternFallback'

// It accepts exactly the string "magic", so an answer that follows the
// RegExp instead is visible.
function magic (log) {
  return (src, flags) => {
    if (log) log.push([src, flags])
    return { test: (s) => s === 'magic' }
  }
}

const S_PATTERN = { type: 'object', properties: { a: { type: 'string', pattern: BACKREF } } }
const S_PATTERN_PROPS = { type: 'object', patternProperties: { [LOOKAHEAD]: { type: 'number' } } }
const S_PROPERTY_NAMES = { type: 'object', propertyNames: { pattern: NEG_LOOKAHEAD } }

// ---- one entry, the feature registered ----

async function entryChecks (kind) {
  const { Validator } = await load(ENTRY[kind])
  const F = await load('index.v2.features.mjs')
  // Every feature the entry takes: the full entries carry the schema-decided
  // groups built in and refuse to register them.
  for (const f of Object.values(F)) {
    if (typeof f !== 'object' || f === null) continue
    try { Validator.use(f) } catch (e) { if (!(e instanceof TypeError && /not an ata-validator feature/.test(e.message))) throw e }
  }
  const codegenAllowed = (() => { try { return new Function('return 1')() === 1 } catch { return false } })()

  // --- the option value ---

  check('unknown values are refused at the first use', () => {
    for (const bad of ['Reject', 'off', '', 1, 0, true, false, null, {}, []]) {
      const v = new Validator({ type: 'string' }, { patternFallback: bad })
      for (const call of [() => v.validate('x'), () => v.isValidObject('x'), () => v.addSchema({ $id: 'https://example.com/x' })]) assert.throws(call, TypeError, JSON.stringify(bad))
    }
  })
  check("'platform' and undefined change nothing", () => {
    for (const opt of [{}, { patternFallback: 'platform' }, { patternFallback: undefined }]) {
      const v = new Validator(S_PATTERN, opt)
      assert.strictEqual(v.validate({ a: 'aa' }).valid, true)
      assert.strictEqual(v.validate({ a: 'ab' }).valid, false)
      assert.strictEqual(v.isValidObject({ a: 'aa' }), true)
      assert.strictEqual(v._pf, undefined)
      assert.ok(!Object.hasOwn(v, 'core') && !Object.hasOwn(v, '_count'))
      if (kind === 'edge') assert.strictEqual(v._engine.constructor.name, 'Engine')
    }
  })

  // --- 'reject' ---

  function rejects (schema, source, where, opts) {
    // The constructor reads nothing of the schema; the first use refuses it,
    // each time it is tried.
    const v = new Validator(schema, { ...opts, patternFallback: 'reject' })
    let err = null
    for (const call of [() => v.isValidObject(null), () => v.validate(null), () => v.validateJSON('null')]) {
      err = null
      try { call() } catch (e) { err = e }
      assert.ok(err, 'expected a refusal for ' + JSON.stringify(source))
    }
    assert.ok(err, 'expected a refusal for ' + JSON.stringify(source))
    assert.ok(err.message.includes(JSON.stringify(source)), err.message)
    assert.ok(err.message.includes(OUTSIDE), err.message)
    if (where) assert.ok(err.message.includes(' at ' + where + ' '), err.message + ' should name ' + where)
  }

  check("'reject' refuses each kind of pattern outside the engine, at the first use", () => {
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
    // every object, so a `default`, `const` or `enum` value counts.
    rejects({ $ref: '#/default', default: { pattern: BACKREF } }, BACKREF, '#/default/pattern')
    rejects({ $ref: '#/const', const: { pattern: BACKREF } }, BACKREF, '#/const/pattern')
    rejects({ enum: [1, { patternProperties: { [LOOKAHEAD]: {} } }] }, LOOKAHEAD, '#/enum/1/patternProperties/' + LOOKAHEAD)
    rejects({ $ref: '#/x-ext/s', 'x-ext': { s: { pattern: BACKREF } } }, BACKREF, '#/x-ext/s/pattern')
    rejects({ anyOf: [{ not: { if: { pattern: 'a' }, then: { pattern: BACKREF } } }] }, BACKREF, '#/anyOf/0/not/then/pattern')
  })
  check("'reject' reads a keyword the engines read by name: not enumerable, or on a prototype", () => {
    const hidden = { type: 'string' }
    Object.defineProperty(hidden, 'pattern', { value: BACKREF, enumerable: false })
    rejects({ properties: { a: hidden } }, BACKREF, '#/properties/a/pattern')
    rejects({ properties: { a: Object.create({ pattern: BACKREF }) } }, BACKREF, '#/properties/a/pattern')
    const pp = {}
    Object.defineProperty(pp, LOOKAHEAD, { value: {}, enumerable: false })
    rejects({ patternProperties: pp }, LOOKAHEAD, '#/patternProperties/' + LOOKAHEAD)
  })
  check("'reject' scans the documents registered beside the root: the schemas option, as a list and as a map, and addSchema()", () => {
    const ext = { $id: 'https://example.com/ext.json', type: 'string', pattern: BACKREF }
    rejects({ $ref: 'https://example.com/ext.json' }, BACKREF, 'https://example.com/ext.json#/pattern', { schemas: [ext] })
    rejects({ $ref: 'https://example.com/ext.json' }, BACKREF, 'https://example.com/other.json#/pattern', { schemas: { 'https://example.com/other.json': ext } })
    const v = new Validator({ $ref: 'https://example.com/ext.json' }, { patternFallback: 'reject' })
    assert.throws(() => v.addSchema(ext), (e) => e.message.includes(JSON.stringify(BACKREF)) && e.message.includes('https://example.com/ext.json#/pattern'))
    // The refused document was not registered.
    v.addSchema({ $id: 'https://example.com/ext.json', type: 'string', pattern: '^a+$' })
    assert.strictEqual(v.validate('aa').valid, true)
    assert.strictEqual(v.validate('b').valid, false)
  })
  check('the option is read by name: inherited or not enumerable, it is honoured', () => {
    const hidden = {}
    Object.defineProperty(hidden, 'patternFallback', { value: 'reject', enumerable: false })
    for (const o of [Object.create({ patternFallback: 'reject' }), hidden]) {
      assert.throws(() => new Validator(S_PATTERN, o).validate({}), (e) => e.message.includes(OUTSIDE))
    }
    const v = new Validator(S_PATTERN, Object.create({ patternFallback: magic() }))
    assert.strictEqual(v.validate({ a: 'magic' }).valid, true)
    assert.strictEqual(v.isValidObject({ a: 'aa' }), false)
  })
  check("'reject' refuses a schema given as text", () => {
    rejects(JSON.stringify(S_PATTERN), BACKREF, '#/properties/a/pattern')
  })
  check("'reject' leaves linear patterns alone, on the same engines and with the same answers", () => {
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
    // On the edge entry both answer on the verdict core.
    if (kind === 'edge') assert.strictEqual(strict._build().constructor.name, 'Engine')
    else strict._build()
    assert.strictEqual(strict._pf.matchers.size, 0)
    assert.ok(!Object.hasOwn(strict, '_count'))
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
  check("'reject' refuses the vendored meta-schemas nothing, in the scan and in the engine", () => {
    for (const [, meta] of F.metaschemas.map) new Validator(meta, { patternFallback: 'reject' }).validate({ type: 'string' })
    const v = new Validator({ $ref: 'https://json-schema.org/draft/2020-12/schema' }, { patternFallback: 'reject' })
    assert.strictEqual(v.validate({ type: 'string' }).valid, true)
    assert.strictEqual(v.validate({ type: 1 }).valid, false)
  })
  check('a pattern the scan did not see is refused where the small engine compiles it, in either mode', () => {
    // The schema is read-only once a validator is built from it; a change
    // made after the scan stands in for anything a scan could miss. The
    // scan is made when the validator is first given a document.
    const log = []
    for (const mode of ['reject', magic(log)]) {
      for (const call of [(v) => v.validate({ a: 'aa' }), (v) => v.validateJSON('{"a":"aa"}')]) {
        const s = { type: 'object', properties: { a: { type: 'string' } } }
        const v = new Validator(s, { patternFallback: mode })
        v.addSchema({ $id: 'https://example.com/none.json' })
        s.properties.a.pattern = BACKREF
        for (let i = 0; i < 2; i++) assert.throws(() => call(v), (e) => e.message.includes(JSON.stringify(BACKREF)) && e.message.includes('was not in the schema when it was scanned'))
      }
    }
    assert.strictEqual(log.length, 0)
    // The passes of a validator that holds a matcher ask the same hook.
    const s = { type: 'object', properties: { p: { pattern: BACKREF } }, patternProperties: { '^a': {} }, additionalProperties: false }
    const v = new Validator(s, { removeAdditional: true, patternFallback: magic() })
    v.addSchema({ $id: 'https://example.com/none.json' })
    s.patternProperties = { [LOOKAHEAD]: {} }
    assert.throws(() => v.validate({ xy: 1 }), (e) => e.message.includes('was not in the schema when it was scanned'))
  })

  // --- a function ---

  check('the function is called once per pattern, at the first use, with source and flags', () => {
    const log = []
    const schema = {
      type: 'object',
      properties: { a: { type: 'string', pattern: BACKREF }, b: { type: 'string', pattern: BACKREF }, c: { type: 'string', pattern: '^[a-z]+$' }, d: { pattern: '^[\\w-.]+(?=x)' } },
      patternProperties: { [LOOKAHEAD]: {} },
      propertyNames: { pattern: NEG_LOOKAHEAD },
    }
    const v = new Validator(schema, { patternFallback: magic(log) })
    assert.strictEqual(log.length, 0)
    v.isValidObject({})
    // No linear pattern reaches it; a pattern twice is asked about once; the
    // flags are those the platform RegExp would have used (`[\w-.]` is valid
    // only without the u flag).
    assert.deepStrictEqual(log, [[BACKREF, 'u'], ['^[\\w-.]+(?=x)', ''], [LOOKAHEAD, 'u'], [NEG_LOOKAHEAD, 'u']])
    for (let i = 0; i < 3; i++) { v.validate({ a: 'aa' }); v.isValidObject({ a: 'magic' }); v.validateJSON('{"b":"x"}'); v.isValidJSON('{"b":"x"}') }
    assert.strictEqual(log.length, 4)
  })
  check('the function decides for each kind of pattern outside the engine', () => {
    for (const p of FALLBACKS) {
      const v = new Validator({ type: 'string', pattern: p }, { patternFallback: magic() })
      assert.strictEqual(v.validate('magic').valid, true, p)
      assert.strictEqual(v.validate('aa').valid, false, p)
      assert.strictEqual(v.isValidObject('magic'), true, p)
      assert.strictEqual(v.isValidObject('aa'), false, p)
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
      for (const s of ['Émile', 'ab', 'a'.repeat(70000), 'x1', '', 'magic']) {
        assert.strictEqual(strict.validate(s).valid, plain.validate(s).valid, p)
        assert.strictEqual(fn.isValidObject(s), plain.isValidObject(s), p)
        assert.strictEqual(fn.validate(s).valid, plain.validate(s).valid, p)
      }
      assert.strictEqual(log.length, 0, p)
      assert.strictEqual(fn._pf.matchers.size, 0, p)
      assert.strictEqual(strict._pf.matchers.size, 0, p)
    }
  })
  check('a linear pattern is not handed to the function', () => {
    const log = []
    const v = new Validator({ type: 'string', pattern: '^[a-z]+\\d?$' }, { patternFallback: magic(log) })
    assert.strictEqual(v.validate('ab1').valid, true)
    assert.strictEqual(v.validate('magic!').valid, false)
    assert.strictEqual(log.length, 0)
  })

  // Every entry point of the 2.0 Validator, in both orders of first use (the
  // edge entry answers a validator first asked for a verdict differently
  // from one first asked to validate).
  function allPaths (schema, opts) {
    const order = [
      ['validate', (v, d) => v.validate(d).valid],
      ['isValidObject', (v, d) => v.isValidObject(d)],
      ['validateJSON', (v, d) => v.validateJSON(JSON.stringify(d)).valid],
      ['isValidJSON', (v, d) => v.isValidJSON(JSON.stringify(d))],
      ['~standard', (v, d) => !v['~standard'].validate(d).issues],
    ]
    return (doc) => {
      const answers = []
      for (let first = 0; first < order.length; first++) {
        const v = new Validator(schema, opts)
        const calls = order.slice(first).concat(order.slice(0, first))
        for (let round = 0; round < 2; round++) for (const [name, f] of calls) answers.push([name, f(v, structuredClone(doc))])
      }
      for (const [name, a] of answers) assert.strictEqual(a, answers[0][1], name + ' disagrees on ' + JSON.stringify(doc))
      return answers[0][1]
    }
  }

  check('pattern: every entry point asks the function', () => {
    const all = allPaths(S_PATTERN, { patternFallback: magic() })
    assert.strictEqual(all({ a: 'magic' }), true)
    assert.strictEqual(all({ a: 'aa' }), false)
  })
  check('patternProperties: every entry point asks the function', () => {
    const all = allPaths(S_PATTERN_PROPS, { patternFallback: magic() })
    assert.strictEqual(all({ magic: 'not a number' }), false)
    assert.strictEqual(all({ magic: 1 }), true)
    assert.strictEqual(all({ xy: 'not a number' }), true)
  })
  check('propertyNames: every entry point asks the function', () => {
    const all = allPaths(S_PROPERTY_NAMES, { patternFallback: magic() })
    assert.strictEqual(all({ magic: 1 }), true)
    assert.strictEqual(all({ good: 1 }), false)
  })
  check('patternProperties beside unevaluatedProperties and additionalProperties ask the function', () => {
    const un = allPaths({ type: 'object', patternProperties: { [LOOKAHEAD]: {} }, unevaluatedProperties: false }, { patternFallback: magic() })
    assert.strictEqual(un({ magic: 1 }), true)
    assert.strictEqual(un({ xy: 1 }), false)
    const ad = allPaths({ type: 'object', patternProperties: { [LOOKAHEAD]: {} }, additionalProperties: false }, { patternFallback: magic() })
    assert.strictEqual(ad({ magic: 1 }), true)
    assert.strictEqual(ad({ xy: 1 }), false)
  })
  check('a pattern behind a reference, in a branch and in an item asks the function', () => {
    const all = allPaths({ $defs: { p: { type: 'string', pattern: BACKREF } }, anyOf: [{ type: 'array', items: { $ref: '#/$defs/p' } }, { type: 'number' }] }, { patternFallback: magic() })
    assert.strictEqual(all(['magic', 'magic']), true)
    assert.strictEqual(all(['magic', 'aa']), false)
    assert.strictEqual(all(1), true)
  })
  check('the errors name the pattern and come from the function', () => {
    const v = new Validator(S_PATTERN, { patternFallback: magic() })
    const r = v.validate({ a: 'aa' })
    assert.strictEqual(r.valid, false)
    assert.strictEqual(r.errors[0].keyword, 'pattern')
    assert.strictEqual(r.errors[0].instancePath, '/a')
    const pn = new Validator(S_PROPERTY_NAMES, { patternFallback: magic() }).validate({ good: 1 })
    assert.ok(pn.errors.some((e) => e.keyword === 'pattern' || e.keyword === 'propertyNames'), JSON.stringify(pn.errors))
    for (const opts of [{ abortEarly: true }, { verbose: true }, { richErrors: false }, { richErrors: true }]) {
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
    // Without the option the RegExp decides, and the keys kept are the others.
    const plain = { id: 1, magic: 2, xy: 3 }
    new Validator(schema, { removeAdditional: true }).validate(plain)
    assert.deepStrictEqual(plain, { id: 1, xy: 3 })
  })
  check('defaults under patternProperties follow the function', () => {
    const schema = { type: 'object', patternProperties: { [LOOKAHEAD]: { type: 'object', properties: { d: { default: 7 } } } } }
    const v = new Validator(schema, { patternFallback: magic() })
    const doc = { magic: {}, xy: {} }
    assert.strictEqual(v.validate(doc).valid, true)
    assert.deepStrictEqual(doc, { magic: { d: 7 }, xy: {} })
    const plain = { magic: {}, xy: {} }
    new Validator(schema).validate(plain)
    assert.deepStrictEqual(plain, { magic: {}, xy: { d: 7 } })
    // useDefaults: false fills nothing, with a matcher as without.
    const off = { magic: {}, xy: {} }
    assert.strictEqual(new Validator(schema, { useDefaults: false, patternFallback: magic() }).validate(off).valid, true)
    assert.deepStrictEqual(off, { magic: {}, xy: {} })
    // The passes run in the Validator's order with a matcher held: removal,
    // coercion, then defaults.
    const all = { type: 'object', properties: { n: { type: 'number' }, d: { type: 'string', default: 'x' } }, patternProperties: { [LOOKAHEAD]: { type: 'object', properties: { d: { default: 7 } } } }, additionalProperties: false }
    const three = { n: '5', magic: {}, xy: {} }
    assert.strictEqual(new Validator(all, { removeAdditional: true, coerceTypes: true, patternFallback: magic() }).validate(three).valid, true)
    assert.deepStrictEqual(three, { n: 5, magic: { d: 7 }, d: 'x' })
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
    assert.strictEqual(a.isValidObject('aa'), false)
    const b = new Validator({ $ref: 'https://example.com/p.json' }, { patternFallback: magic(log) })
    b.addSchema(ext)
    assert.strictEqual(b._pf.matchers.size, 1, 'a validator comes to hold a matcher through addSchema()')
    assert.strictEqual(b.isValidObject('magic'), true)
    assert.strictEqual(b.isValidObject('aa'), false)
    assert.strictEqual(b.validate('aa').valid, false)
    assert.notStrictEqual(b._engine.constructor.name, 'Engine', 'and leaves the verdict core')
    assert.strictEqual(log.length, 2)
  })
  check('the matcher contract: an object with test, a boolean answer, errors propagate', () => {
    for (const bad of [undefined, null, 1, 'x', {}, { test: 1 }]) {
      assert.throws(() => new Validator(S_PATTERN, { patternFallback: () => bad }).validate({}), TypeError, String(bad))
    }
    // A RegExp is an object with a test function, so it is accepted as one.
    const re = new Validator(S_PATTERN, { patternFallback: (s, f) => new RegExp(s, f) })
    assert.strictEqual(re.validate({ a: 'aa' }).valid, true)
    assert.strictEqual(re.validate({ a: 'ab' }).valid, false)
    const boom = new Error('boom')
    assert.throws(() => new Validator(S_PATTERN, { patternFallback: () => { throw boom } }).validate({}), (e) => e === boom)
    const thrower = new Validator(S_PATTERN, { patternFallback: () => ({ test () { throw boom } }) })
    assert.throws(() => thrower.validate({ a: 'x' }), (e) => e === boom)
    assert.throws(() => thrower.isValidObject({ a: 'x' }), (e) => e === boom)
    for (const answer of [1, 0, 'true', null, undefined, {}]) {
      const v = new Validator(S_PATTERN, { patternFallback: () => ({ test: () => answer }) })
      assert.throws(() => v.validate({ a: 'x' }), TypeError, String(answer))
      assert.throws(() => v.isValidObject({ a: 'x' }), TypeError, String(answer))
      assert.throws(() => v.isValidJSON('{"a":"x"}'), TypeError, String(answer))
    }
  })

  // --- which engines answer ---

  check('a validator that holds a matcher answers on the small engine alone', () => {
    const v = new Validator(S_PATTERN, { patternFallback: magic() })
    v.isValidObject({ a: 'magic' })
    assert.strictEqual(v._pf.matchers.size, 1)
    assert.ok(Object.hasOwn(v, '_count'))
    assert.strictEqual(typeof v._engine.isValid, 'function')
    // On the edge entry the engine would otherwise be the verdict core's.
    if (kind === 'edge') assert.strictEqual(new Validator(S_PATTERN)._build().constructor.name, 'Engine')
    assert.notStrictEqual(v._engine.constructor.name, 'Engine')
  })
  check('a function that matches nothing outside the engine leaves the engines in place', () => {
    const log = []
    const v = new Validator({ type: 'string', pattern: '^[a-z]+$' }, { patternFallback: magic(log) })
    assert.strictEqual(v.isValidObject('ab'), true)
    assert.ok(!Object.hasOwn(v, '_count'))
    assert.strictEqual(v.isValidObject('A'), false)
    if (kind === 'edge') assert.strictEqual(v._engine.constructor.name, 'Engine')
    assert.strictEqual(log.length, 0)
  })
  await checkAsync('a validator that holds a matcher never moves to generated code', async () => {
    // Asked before its first use, and after it.
    const fresh = new Validator(S_PATTERN, { patternFallback: magic() })
    assert.strictEqual(await fresh._tierUp(), false)
    assert.strictEqual(fresh._full, null)
    assert.strictEqual(fresh.validate({ a: 'aa' }).valid, false)
    const v = new Validator(S_PATTERN, { patternFallback: magic() })
    v.isValidObject({})
    assert.strictEqual(await v._tierUp(), false)
    assert.strictEqual(v._full, null)
    // A hot validator: far past the count that would tier it up.
    for (let i = 0; i < 2500; i++) { v.isValidObject({ a: 'aa' }); v.validate({ a: 'magic' }) }
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.strictEqual(v._full, null)
    assert.ok(v._calls <= 1, 'calls are not counted once the validator is built')
    assert.strictEqual(v.validate({ a: 'magic' }).valid, true)
    assert.strictEqual(v.isValidObject({ a: 'aa' }), false)
    // One that holds none tiers up as any other, and answers the same after.
    const linear = new Validator({ type: 'string', pattern: '^[a-z]+$' }, { patternFallback: magic() })
    const up = await linear._tierUp()
    assert.strictEqual(up, codegenAllowed)
    assert.strictEqual(linear.validate('ab').valid, true)
    assert.strictEqual(linear.validate('magic!').valid, false)
    const strict = new Validator({ type: 'string', pattern: '^[a-z]+$' }, { patternFallback: 'reject' })
    assert.strictEqual(await strict._tierUp(), codegenAllowed)
    assert.strictEqual(strict.isValidObject('ab'), true)
    assert.strictEqual(strict.isValidObject('A'), false)
  })

  // --- caches ---

  check('validators of the same schema with different modes do not share answers', () => {
    const schema = { type: 'object', properties: { a: { type: 'string', pattern: BACKREF } }, patternProperties: { [LOOKAHEAD]: { type: 'number' } } }
    const docs = [{ a: 'aa' }, { a: 'magic' }, { a: 'other' }, { xy: 'q' }, { magic: 'q' }]
    const expectPlatform = [true, false, false, false, true]
    const expectMagic = [false, true, false, true, false]
    const each = (v, f) => docs.map((d) => f(v, d))
    // The default validator first, so every table holds its compile.
    const plain = new Validator(schema)
    for (const d of docs) { plain.isValidObject(d); plain.validate(d); plain.validateJSON(JSON.stringify(d)) }
    for (let round = 0; round < 3; round++) {
      const m = new Validator(schema, { patternFallback: magic() })
      assert.deepStrictEqual(each(m, (v, d) => v.isValidObject(d)), expectMagic, 'round ' + round)
      assert.deepStrictEqual(each(m, (v, d) => v.validate(d).valid), expectMagic, 'round ' + round)
      assert.deepStrictEqual(each(m, (v, d) => v.isValidJSON(JSON.stringify(d))), expectMagic, 'round ' + round)
      assert.throws(() => new Validator(schema, { patternFallback: 'reject' }).validate({}), (e) => e.message.includes(OUTSIDE))
      // The validator built before, and one built now, without the option.
      assert.deepStrictEqual(each(plain, (v, d) => v.isValidObject(d)), expectPlatform, 'round ' + round)
      assert.deepStrictEqual(each(plain, (v, d) => v.validate(d).valid), expectPlatform, 'round ' + round)
      assert.deepStrictEqual(each(new Validator(schema), (v, d) => v.isValidObject(d)), expectPlatform, 'round ' + round)
      assert.deepStrictEqual(each(new Validator(schema, {}), (v, d) => v.validate(d).valid), expectPlatform, 'round ' + round)
      assert.deepStrictEqual(each(new Validator(schema, { patternFallback: 'platform' }), (v, d) => v.isValidObject(d)), expectPlatform, 'round ' + round)
    }
  })
  check('a pattern first compiled for a function is not what a later default validator gets, in either order', () => {
    // Sources no other check uses, so no table holds them yet.
    const first = '^(q)\\1$'
    const m = new Validator({ type: 'string', pattern: first }, { patternFallback: magic() })
    assert.strictEqual(m.isValidObject('magic'), true)
    assert.strictEqual(m.validate('qq').valid, false)
    const p = new Validator({ type: 'string', pattern: first })
    assert.strictEqual(p.isValidObject('qq'), true)
    assert.strictEqual(p.isValidObject('magic'), false)
    assert.strictEqual(p.validate('magic').valid, false)
    const second = '^(w)\\1$'
    const p2 = new Validator({ type: 'string', pattern: second })
    assert.strictEqual(p2.isValidObject('ww'), true)
    assert.strictEqual(p2.validate('magic').valid, false)
    const m2 = new Validator({ type: 'string', pattern: second }, { patternFallback: magic() })
    assert.strictEqual(m2.isValidObject('ww'), false)
    assert.strictEqual(m2.isValidObject('magic'), true)
    assert.strictEqual(p2.isValidObject('ww'), true)
    assert.strictEqual(p2.isValidObject('magic'), false)
  })
  check('two functions on the same schema each answer for their own validator', () => {
    const schema = { type: 'string', pattern: BACKREF }
    const only = (word) => () => ({ test: (s) => s === word })
    const one = new Validator(schema, { patternFallback: only('one') })
    const two = new Validator(schema, { patternFallback: only('two') })
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(one.validate('one').valid, true)
      assert.strictEqual(one.validate('two').valid, false)
      assert.strictEqual(one.isValidObject('two'), false)
      assert.strictEqual(two.validate('two').valid, true)
      assert.strictEqual(two.isValidObject('one'), false)
      assert.strictEqual(two.isValidJSON('"one"'), false)
    }
    const s = JSON.stringify(schema)
    assert.strictEqual(new Validator(s, { patternFallback: only('x') }).validate('x').valid, true)
    assert.strictEqual(new Validator(s, {}).validate('x').valid, false)
  })
  check('the function a validator first used is the one it keeps', () => {
    // The option is read at the first use, as every option of a 2.0 validator.
    const schema = { type: 'string', pattern: BACKREF }
    const opts = { patternFallback: () => ({ test: (s) => s === 'first' }) }
    const v = new Validator(schema, opts)
    assert.strictEqual(v.isValidObject('first'), true)
    opts.patternFallback = () => ({ test: () => true })
    assert.strictEqual(v.validate('first').valid, true)
    assert.strictEqual(v.validate('other').valid, false)
    assert.strictEqual(v.isValidObject('other'), false)
  })

  // --- featuresFor() ---

  check('featuresFor() names the feature for the option, and not without it', () => {
    assert.ok(F.featuresFor(S_PATTERN, { patternFallback: 'reject' }).includes('patternFallback'))
    assert.ok(F.featuresFor({ type: 'string' }, { patternFallback: magic() }).includes('patternFallback'))
    assert.ok(F.featuresFor(S_PATTERN, { patternFallback: null }).includes('patternFallback'))
    for (const o of [undefined, {}, { patternFallback: 'platform' }, { patternFallback: undefined }]) assert.ok(!F.featuresFor(S_PATTERN, o).includes('patternFallback'), JSON.stringify(o))
    // The other features the schema needs are named as without the option.
    assert.deepStrictEqual(F.featuresFor(S_PATTERN, { patternFallback: 'reject' }).filter((n) => n !== 'patternFallback'), F.featuresFor(S_PATTERN))
    assert.throws(() => F.featuresFor(S_PATTERN, { patternFallback: 'reject', nope: 1 }), { message: 'ata2: option nope' })
  })

  done(kind)
  console.log(`ok (${kind}): ${passed} checks`)
}

// ---- one entry, the feature not registered ----

async function refusalChecks (kind) {
  const { Validator } = await load(ENTRY[kind])
  if (kind === 'core') {
    // Everything a schema below needs but the feature itself.
    const G = (await load('lib/features/groups.js')).default
    Validator.use(...G.all)
  }
  check('the constructor refuses the option as any unknown one, whatever its value', () => {
    for (const mode of ['reject', magic(), 'platform', 'nope', '', null, 0, false, 1, true, {}]) {
      for (const s of [S_PATTERN, { type: 'string' }, { type: 'string', pattern: '^[a-z]+$' }, true]) {
        assert.throws(() => new Validator(s, { patternFallback: mode }), (e) => e instanceof Error && e.message === UNKNOWN, String(mode))
      }
    }
  })
  check('the option left out or undefined builds and answers on the platform RegExp', () => {
    for (const opt of [{ patternFallback: undefined }, {}]) {
      const v = new Validator(S_PATTERN, opt)
      assert.strictEqual(v.validate({ a: 'aa' }).valid, true)
      assert.strictEqual(v.isValidObject({ a: 'magic' }), false)
    }
  })
  const { patternFallback } = (await load('lib/features/patternFallback.js')).default
  check('once registered, the option is honoured', () => {
    Validator.use(patternFallback)
    const v = new Validator(S_PATTERN, { patternFallback: magic() })
    assert.strictEqual(v.validate({ a: 'magic' }).valid, true)
    assert.strictEqual(v.isValidObject({ a: 'aa' }), false)
    assert.throws(() => new Validator(S_PATTERN, { patternFallback: 'reject' }).validate({}), (e) => e.message.includes(OUTSIDE))
    // Registered again, it is installed once.
    const built = Validator.prototype._build
    Validator.use(patternFallback)
    assert.strictEqual(Validator.prototype._build, built)
    const log = []
    new Validator(S_PATTERN, { patternFallback: magic(log) }).validate({})
    assert.strictEqual(log.length, 1)
    const p = new Validator(S_PATTERN, { patternFallback: 'platform' })
    assert.strictEqual(p.validate({ a: 'aa' }).valid, true)
    assert.strictEqual(p.isValidObject({ a: 'magic' }), false)
  })
  check('removeAdditional beside a matcher is refused by name without its feature', () => {
    const v = new Validator(S_PATTERN_PROPS, { removeAdditional: true, patternFallback: magic() })
    assert.throws(() => v.validate({}), { message: 'ata2: removeAdditional, Validator.use(removeAdditional)' })
    // Not asked for, nothing is refused and nothing removed.
    const doc = { xy: 1, magic: 2 }
    assert.strictEqual(new Validator(S_PATTERN_PROPS, { patternFallback: magic() }).validate(doc).valid, true)
    assert.deepStrictEqual(doc, { xy: 1, magic: 2 })
  })
  done(kind + ', not registered')
  console.log(`ok (${kind}, feature not registered): ${passed} checks`)
}

// ---- ata-validator/ir, and what a bundle carries ----

async function irChecks () {
  const ir = await load('lib/ir/index.mjs')
  const linear = { type: 'string', pattern: '^[a-z]+$' }
  const writers = {
    specialize: (s, o) => ir.specialize(s, o),
    tableModule: (s, o) => ir.tableModule(s, o),
    tablePlan: (s, o) => ir.tablePlan(s, o),
    closureModule: (s, o) => ir.closureModule(s, { richErrors: false, ...o }),
    pickModules: (s, o) => ir.pickModules([linear, s], o, (t) => t.length),
  }
  for (const [name, write] of Object.entries(writers)) {
    check(name + " refuses a function, whatever the schema's patterns", () => {
      for (const s of [S_PATTERN, linear, { type: 'string' }]) assert.throws(() => write(s, { patternFallback: magic() }), (e) => e instanceof TypeError && /function cannot be carried/.test(e.message))
    })
    check(name + " honours 'reject' when the module is written, naming pattern and location", () => {
      assert.throws(() => write(S_PATTERN, { patternFallback: 'reject' }), (e) => e.message.includes(JSON.stringify(BACKREF)) && e.message.includes(' at #/properties/a/pattern ') && e.message.includes(OUTSIDE))
      assert.throws(() => write(S_PATTERN_PROPS, { patternFallback: 'reject' }), (e) => e.message.includes(JSON.stringify(LOOKAHEAD)) && e.message.includes('#/patternProperties/'))
      assert.throws(() => write({ $ref: '#/default', default: { pattern: PROPERTY } }, { patternFallback: 'reject' }), (e) => e.message.includes('#/default/pattern'))
      for (const p of FALLBACKS) assert.throws(() => write({ type: 'string', pattern: p }, { patternFallback: 'reject' }), (e) => e.message.includes(OUTSIDE), p)
    })
    check(name + " writes a schema of linear patterns under 'reject' as it does without the option", () => {
      for (const s of [linear, { type: 'string', pattern: '^\\p{L}+$' }, { type: 'object', properties: { a: { type: 'string', pattern: '^(a+)+$' } } }]) {
        assert.deepStrictEqual(write(s, { patternFallback: 'reject' }), write(s, {}), JSON.stringify(s))
        assert.deepStrictEqual(write(s, { patternFallback: 'platform' }), write(s, {}), JSON.stringify(s))
      }
    })
    check(name + ' refuses an unknown value', () => {
      for (const bad of ['nope', '', null, 1, true, {}]) assert.throws(() => write(linear, { patternFallback: bad }), TypeError, String(bad))
    })
  }
  check("specialize under 'reject' scans the documents in `schemas`", () => {
    const ext = { $id: 'https://example.com/ext.json', type: 'string', pattern: BACKREF }
    assert.throws(() => ir.specialize({ $ref: 'https://example.com/ext.json' }, { schemas: [ext], patternFallback: 'reject' }), (e) => e.message.includes('https://example.com/ext.json#/pattern'))
    assert.throws(() => ir.specialize({ $ref: 'https://example.com/ext.json' }, { schemas: { 'https://example.com/ext.json': ext }, patternFallback: 'reject' }), (e) => e.message.includes('https://example.com/ext.json#/pattern'))
  })
  check("compileClosures takes 'platform' only, and says so with an ir: error", () => {
    for (const mode of ['reject', magic(), 'nope', '', null, 0]) {
      for (const s of [S_PATTERN, linear]) assert.throws(() => ir.compileClosures(s, { patternFallback: mode }), (e) => e.message === 'ir: patternFallback needs the Validator', String(mode))
    }
    for (const o of [{}, { patternFallback: 'platform' }, { patternFallback: undefined }]) {
      const c = ir.compileClosures(S_PATTERN, o)
      assert.strictEqual(c.isValid({ a: 'aa' }), true)
      assert.strictEqual(c.isValid({ a: 'ab' }), false)
    }
  })
  check("what 'reject' lets through runs on the linear engine or a RegExp shown linear, in every engine (official suite patterns)", () => {
    const { make } = require(path.join(ROOT, 'lib', 'pattern-fallback.js'))
    const { nativeIsLinear } = require(path.join(ROOT, 'lib', 'regex-linear'))
    const shared = require(path.join(ROOT, 'lib', 'engine-shared.js'))
    const sharedCore = require(path.join(ROOT, 'lib', 'engine-shared-core.js'))
    const { patterns } = require(path.join(ROOT, 'lib', 'features', 'patterns.js'))
    const choice = require(path.join(ROOT, 'lib', 'pattern-choice.js'))
    const C = require(path.join(ROOT, 'lib', 'core', 'verdict.js'))
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
    for (const p of FALLBACKS) pats.add(p)
    const refused = (compile, p) => { try { make('reject', compile).scan({ pattern: p }); return false } catch (e) { if (!e.message.includes(OUTSIDE)) throw e; return true } }
    const ok = (m, p) => !(m instanceof RegExp) || nativeIsLinear(p)
    let survivors = 0; let out = 0
    for (const p of pats) {
      try { new RegExp(p, 'u') } catch { try { new RegExp(p) } catch { continue } }
      // The full entries' engine and the plugin core's give the same answer.
      const full = refused((s) => shared.compilePattern(s), p)
      assert.strictEqual(refused((s) => sharedCore.compilePattern(s, patterns), p), full, p)
      if (full) { out++; continue }
      survivors++
      assert.ok(ok(shared.compilePattern(p), p), 'the small engine of the full entries: ' + p)
      assert.ok(ok(sharedCore.compilePattern(p, patterns), p), "the plugin core's small engine: " + p)
      // The verdict core: its own sequence matcher, a RegExp shown linear,
      // or the engines' compile.
      assert.ok(ok(C._i.pattern(p), p), 'the verdict core: ' + p)
      // Generated code a hot validator moves to: the linear engine, a RegExp
      // shown linear, or declined.
      assert.ok(choice.useSafeEngine(p) || nativeIsLinear(p) || !choice.patternEngineOk(p), 'generated code: ' + p)
    }
    assert.ok(survivors >= 30 && out >= FALLBACKS.length, survivors + ' ' + out)
  })
  await checkAsync('a bundle carries the feature only where a page imports it', async () => {
    let esbuild = null
    try { esbuild = require('esbuild') } catch {}
    if (esbuild === null) return
    for (const entry of Object.values(ENTRY)) {
      for (const add of [true, false]) {
        const src = `import { Validator } from ${JSON.stringify(path.join(ROOT, entry))}\n` + (add ? `import { patternFallback } from ${JSON.stringify(path.join(ROOT, 'lib/features/patternFallback.js'))}\nValidator.use(patternFallback)\n` : '') + 'export { Validator }\n'
        const r = await esbuild.build({ stdin: { contents: src, resolveDir: ROOT }, bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' })
        const text = r.outputFiles.map((f) => f.text).join('\n')
        const inputs = Object.keys(r.metafile.inputs)
        assert.strictEqual(text.includes(OUTSIDE), add, entry + (add ? ' with' : ' without') + ' the feature')
        assert.strictEqual(inputs.some((f) => f.endsWith('lib/pattern-fallback.js')), add, entry + ': lib/pattern-fallback.js')
        assert.strictEqual(inputs.some((f) => f.endsWith('lib/defaults-match.js')), add, entry + ': lib/defaults-match.js')
        if (entry !== ENTRY.edge) assert.strictEqual(inputs.some((f) => f.endsWith('lib/regex-linear.js')), add, entry + ': lib/regex-linear.js')
        // Without the feature a bundle holds the name once, as the slot
        // Validator.use() registers it in.
        if (!add) assert.strictEqual(text.split('patternFallback').length - 1, 1, entry + ' and the name of the option')
      }
    }
  })
}

;(async () => {
  if (KIND !== '') {
    const [kind, mode] = KIND.split(':')
    await (mode === 'refuse' ? refusalChecks(kind) : entryChecks(kind))
    return
  }
  await irChecks()
  done('ir')
  const lines = []
  for (const kind of Object.keys(ENTRY)) {
    for (const mode of ['', ':refuse']) {
      const r = spawnSync(process.execPath, [...process.execArgv, __filename], { env: { ...process.env, ATA_PF2_KIND: kind + mode }, encoding: 'utf8' })
      if (r.status !== 0) failures.push(kind + mode + ':\n' + r.stdout + r.stderr)
      else lines.push(r.stdout.trim())
    }
  }
  done('entries')
  for (const l of lines) console.log(l)
  console.log(`ok: patternFallback on the 2.0 entries, and ${passed} checks of ata-validator/ir, the engines' choices and the bundles`)
})().catch((e) => { console.error(e); process.exit(1) })
