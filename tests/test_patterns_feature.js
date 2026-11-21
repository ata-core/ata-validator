'use strict'

// The patterns feature (ata-validator/features/patterns): the linear pattern
// engine (lib/safe-regex.js) on the 2.0 plugin core. A pattern the platform
// RegExp takes (onPlatform: a Unicode property escape, or plainLinear) runs
// there without it; any other needs it. Held here:
// - featuresFor()'s question and compilePattern's routing are one function:
//   on every pattern of the official suite, SchemaStore and a set of
//   hand-written shapes, featuresFor() names patterns exactly where
//   the core's compilePattern reaches the registered engine, and the core's
//   copy of plainLinear answers as lib/engine-shared.js's;
// - every schema of the suite and SchemaStore that featuresFor() names
//   patterns for is refused without it ("ata2: patterns") and answered with it
//   as the full entry answers, through validate() and `~standard`; every other
//   (linear patterns only) is answered without it as the full entry answers;
// - the passes refuse loudly without it: defaults (lib/defaults-core.js),
//   removeAdditional (with the Validator's matcher) and propertyNames, and a pattern the JSON text does not
//   show is refused where the engine compiles it;
// - the full entries match every pattern with the engine built in and refuse
//   to register the feature;
// - no bundle of the core, alone or with any feature but patterns and the two
//   mutators (shared with the full entries), carries lib/safe-regex.js.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const FRESH = ['validator-small.js', 'groups.js', 'engine-small.js'].map((f) => path.join(ROOT, 'lib', f))
const core = require('../lib/engine-shared-core.js')
const full = require('../lib/engine-shared.js')
const REFUSED = { message: 'ata2: patterns, Validator.use(patterns)' }

const isObj = (v) => v !== null && typeof v === 'object'
function patternsOf (doc, out) {
  const st = [doc]; const seen = new Set()
  while (st.length) {
    const n = st.pop(); if (!isObj(n) || seen.has(n)) continue; seen.add(n)
    if (!Array.isArray(n)) {
      if (typeof n.pattern === 'string') out.add(n.pattern)
      if (isObj(n.patternProperties) && !Array.isArray(n.patternProperties)) for (const k of Object.keys(n.patternProperties)) out.add(k)
    }
    for (const v of Object.values(n)) st.push(v)
  }
  return out
}
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : [])
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return undefined } }

// The suite's groups in every dialect, and SchemaStore's schemas with their
// sample documents, when a checkout sits next to this repository.
const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft7: 'http://json-schema.org/draft-07/schema#', draft6: 'http://json-schema.org/draft-06/schema#', draft4: 'http://json-schema.org/draft-04/schema#', v1: 'https://json-schema.org/v1' }
function suiteCases () {
  const out = []
  for (const [dialect, uri] of Object.entries(DIALECTS)) {
    const dir = path.join(__dirname, 'suite', 'tests', dialect)
    if (!fs.existsSync(dir)) continue
    for (const f of files(dir)) {
      if (f.includes(path.sep + 'optional' + path.sep) && !f.includes('format')) continue
      for (const g of readJSON(f) || []) {
        const schema = isObj(g.schema) && !Array.isArray(g.schema) && g.schema.$schema === undefined ? { $schema: uri, ...g.schema } : g.schema
        out.push({ label: dialect + '/' + path.basename(f) + ': ' + g.description, schema, docs: g.tests.map((t) => t.data) })
      }
    }
  }
  return out
}
const STORE = path.join(ROOT, '..', 'schemastore')
function storeCases () {
  const out = []; const dir = path.join(STORE, 'src', 'schemas', 'json')
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const name = f.slice(0, -5); const schema = readJSON(path.join(dir, f))
    if (schema === undefined) continue
    const docs = []
    for (const t of ['src/test', 'src/negative_test']) {
      const td = path.join(STORE, t, name)
      if (fs.existsSync(td)) for (const x of fs.readdirSync(td).filter((x) => x.endsWith('.json')).sort()) { const d = readJSON(path.join(td, x)); if (d !== undefined) docs.push(d) }
    }
    out.push({ label: 'schemastore/' + name, schema, docs: docs.length ? docs : [{}] })
  }
  return out
}
// Shapes written by hand: groups with alternation, \u escapes, classes with
// ranges, nested repeats, property escapes, lookaround and backreferences.
const HAND = ['^(/|\\./|[A-Za-z]:\\\\)?[^/]+$', '^[^\\u0000]*$', '^(?:a|bc)?x*$', '\\u00e9+', '^(ab|cd)[0-9]{2}$', '^[\\u0041-\\u005A]+$', '^(a|b)?$', '(x|y)z', '^(\\.|-)?\\d+$', '^[\\u00ff\\u0100]$', '^(?:https?|ftp)://[^ ]+$',
  '(a+)+b', '\\p{L}+', '^\\p{Lu}(a|b)*$', '(?=a)b', '(a)\\1', '^[a-z]+$', '^a{65}$', '', '.*', '^$']

;(async () => {
  const F = await import(pathToFileURL(path.join(ROOT, 'index.v2.features.mjs')).href)
  const { featuresFor } = await import(pathToFileURL(path.join(ROOT, 'features', 'index.mjs')).href)
  const cores = new Map()
  const coreWith = (names) => {
    const key = [...names].sort().join(',')
    let V = cores.get(key)
    if (V === undefined) {
      for (const f of FRESH) delete require.cache[f]
      V = require(FRESH[0]).Validator
      if (names.length) V.use(...names.map((n) => F[n]))
      for (const f of FRESH) delete require.cache[f]
      cores.set(key, V)
    }
    return V
  }
  const FULL = require('../lib/validator-full.js').Validator
  FULL.use(F.metaschemas, F.errorMessages)
  const answer = (V, schema, docs, opts) => {
    try {
      const v = new V(schema, opts)
      return JSON.stringify(docs.map((d) => { const x = structuredClone(d); const r = v.validate(x); return [r.valid, (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message]), x] }))
    } catch (e) { return 'throw ' + e.message }
  }
  const standard = (V, schema, docs) => { try { const s = new V(schema)['~standard']; return JSON.stringify(docs.map((d) => s.validate(structuredClone(d)))) } catch (e) { return 'throw ' + e.message } }

  const suite = suiteCases(); const store = storeCases()

  // 1. One question: featuresFor() and the core's compilePattern.
  const pats = new Set(HAND)
  for (const c of suite.concat(store)) patternsOf(c.schema, pats)
  let platform = 0; let linear = 0
  for (const p of pats) {
    assert.strictEqual(core.plainLinear(p), full.plainLinear(p), 'plainLinear of the core copy and of lib/engine-shared.js: ' + JSON.stringify(p))
    const on = core.onPlatform(p)
    let reached = false
    const spy = { compileSafe: (s) => { reached = true; return { test: () => true, source: s } } }
    let compiled = true
    try { core.compilePattern(p, spy) } catch { compiled = false }
    if (compiled) assert.strictEqual(reached, !on, 'compilePattern reaches the engine exactly where onPlatform says no: ' + JSON.stringify(p))
    if (!on) assert.throws(() => core.compilePattern(p, null), REFUSED, 'refused with no engine: ' + JSON.stringify(p))
    else if (compiled) {
      const a = core.compilePattern(p, null); const b = full.compilePattern(p)
      assert.ok(a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags, 'the same RegExp on both copies: ' + JSON.stringify(p))
    }
    for (const s of [{ pattern: p }, { patternProperties: { [p]: {} } }, { propertyNames: { pattern: p } }]) {
      assert.strictEqual(featuresFor(s).includes('patterns'), !on, 'featuresFor() names patterns exactly where compilePattern needs the engine: ' + JSON.stringify(s))
    }
    if (on) platform++; else linear++
  }

  // 2. Every schema: withheld, refused; registered, answered as the full entry.
  let named = 0; let plain = 0; let skipped = 0; let standards = 0
  for (const c of suite.concat(store)) {
    let names
    try { names = featuresFor(c.schema) } catch { skipped++; continue }
    const want = answer(FULL, c.schema, c.docs)
    if (names.includes('patterns')) {
      named++
      const rest = names.filter((n) => n !== 'patterns')
      assert.throws(() => new (coreWith(rest))(c.schema).validate(structuredClone(c.docs[0])), REFUSED, c.label + ': refused without patterns')
      assert.throws(() => new (coreWith(rest.concat('standardSchema')))(c.schema)['~standard'].validate(structuredClone(c.docs[0])), REFUSED, c.label + ': ~standard refused without patterns')
      assert.strictEqual(answer(coreWith(names), c.schema, c.docs), want, c.label + ': answered with patterns as the full entry')
      assert.strictEqual(standard(coreWith(names.concat('standardSchema')), c.schema, c.docs), standard(FULL, c.schema, c.docs), c.label + ': ~standard as the full entry')
      standards++
    } else {
      if (patternsOf(c.schema, new Set()).size === 0) continue
      plain++
      assert.strictEqual(answer(coreWith(names), c.schema, c.docs), want, c.label + ': linear patterns answered without patterns as the full entry')
    }
  }
  // The suite alone: 29 and 56 groups; with SchemaStore 325 and 238.
  assert.ok(named >= 25 && plain >= 50, `${named} schemas need patterns, ${plain} have linear patterns only`)
  if (store.length) assert.ok(named > 250 && plain > 200, named + ' schemas need patterns with SchemaStore, ' + plain + ' linear only')

  // 3. The passes, and patterns the text does not show.
  const deep = '(x|y)+z'
  const pp = { properties: { a: { default: 1 } }, patternProperties: { [deep]: { properties: { b: { default: 2 } } } } }
  assert.deepStrictEqual(featuresFor(pp).sort(), ['defaults', 'patterns'])
  assert.throws(() => new (coreWith(['defaults']))(pp).validate({ xz: {} }), REFUSED, 'defaults: refused without patterns')
  assert.strictEqual(answer(coreWith(['defaults', 'patterns']), pp, [{ xz: {} }, { yyz: {}, a: 3 }, { q: {} }]), answer(FULL, pp, [{ xz: {} }, { yyz: {}, a: 3 }, { q: {} }]), 'defaults: filled as the full entry')
  // The pass itself refuses, not only the question before it.
  const D = require('../lib/features/defaults.js').defaults
  assert.throws(() => D.buildDefaultsApplier(pp, null), REFUSED, 'defaults pass: refused with no engine')
  const fill = D.buildDefaultsApplier(pp, F.patterns); const d1 = { xz: {}, q: {} }; fill(d1)
  const d2 = { xz: {}, q: {} }; require('../lib/defaults.js').buildDefaultsApplier(pp)(d2)
  assert.deepStrictEqual(d1, d2, 'defaults pass: the same fill as lib/defaults.js')
  // Linear and property-escape keys need no engine, and fill as lib/defaults.js does.
  for (const k of ['^x[0-9]+$', '\\p{Lu}', '^(a|b)?$']) {
    const s = { patternProperties: { [k]: { properties: { b: { default: 2 } } } } }
    const a = { x1: {}, A: {}, a: {}, '': {} }; const b = structuredClone(a)
    D.buildDefaultsApplier(s, null)(a); require('../lib/defaults.js').buildDefaultsApplier(s)(b)
    assert.deepStrictEqual(a, b, 'defaults pass without the engine on ' + k)
  }
  const ra = { type: 'object', patternProperties: { [deep]: {} }, additionalProperties: false }
  assert.throws(() => new (coreWith(['removeAdditional', 'branchCollapse']))(ra, { removeAdditional: true }).validate({ xz: 1, q: 2 }), REFUSED, 'removeAdditional: refused without patterns')
  assert.strictEqual(answer(coreWith(['removeAdditional', 'patterns']), ra, [{ xz: 1, q: 2, yxz: 3 }], { removeAdditional: true }), answer(FULL.use(F.removeAdditional), ra, [{ xz: 1, q: 2, yxz: 3 }], { removeAdditional: true }), 'removeAdditional: keys removed as the full entry')
  // The pass takes the Validator's matcher; the core's refuses with no engine.
  const hiddenPP = Object.defineProperty({ type: 'object', additionalProperties: false }, 'patternProperties', { value: { [deep]: {} }, enumerable: false })
  assert.throws(() => new (coreWith(['removeAdditional']))(hiddenPP, { removeAdditional: true }).validate({ xz: 1 }), REFUSED, 'removeAdditional pass: refused where it compiles a name')
  assert.throws(() => F.removeAdditional.build(ra, (src) => core.compilePattern(src, null)), REFUSED)
  const pn = { propertyNames: { pattern: deep } }
  assert.throws(() => new (coreWith([]))(pn).validate({ xz: 1 }), REFUSED, 'propertyNames: refused without patterns')
  assert.strictEqual(answer(coreWith(['patterns']), pn, [{ xz: 1 }, { q: 1 }]), answer(FULL, pn, [{ xz: 1 }, { q: 1 }]), 'propertyNames: answered as the full entry')
  // Not in the JSON text: the question cannot see it, the engine's compile refuses it.
  const hidden = Object.defineProperty({ type: 'string' }, 'pattern', { value: '(a+)+b', enumerable: false })
  assert.deepStrictEqual(featuresFor(hidden), [])
  assert.throws(() => new (coreWith([]))(hidden).validate('aab'), REFUSED, 'a pattern the text does not show: refused where it is compiled')
  assert.strictEqual(new (coreWith(['patterns']))(hidden).validate('aaab').valid, true)
  // A registered document's pattern is asked about too.
  const doc = { $id: 'https://example.com/p', type: 'string', pattern: deep }
  assert.ok(featuresFor({ $ref: 'https://example.com/p' }, { schemas: [doc] }).includes('patterns'))
  assert.ok(featuresFor({ $ref: 'https://example.com/p' }, {}, [doc]).includes('patterns'))
  assert.throws(() => new (coreWith(['defaults']))({ $ref: 'https://example.com/p' }, { schemas: [doc] }).validate('xz'), REFUSED)
  { const v = new (coreWith(['defaults']))({ $ref: 'https://example.com/p' }); v.addSchema(doc); assert.throws(() => v.validate('xz'), REFUSED) }

  // 4. The full entries carry the engine and take no feature for it.
  for (const s of [{ pattern: deep }, pp, pn]) assert.strictEqual(typeof new FULL(s).validate('xz').valid, 'boolean')
  const edge = await import(pathToFileURL(path.join(ROOT, 'index.v2.edge.mjs')).href)
  for (const V of [FULL, edge.Validator]) {
    assert.throws(() => V.use(F.patterns), { name: 'TypeError', message: 'Validator.use: not an ata-validator feature' })
    assert.strictEqual(answer(V, { pattern: deep }, ['xz', 'z', 'xyyxz']), answer(coreWith(['patterns']), { pattern: deep }, ['xz', 'z', 'xyyxz']))
  }

  // 5. Bundles: the engine only with patterns (and removeAdditional).
  const carries = async (names) => {
    const src = `import { Validator } from ${JSON.stringify(path.join(ROOT, 'index.v2.core.mjs'))}\n` + names.map((n, i) => `import { ${n} as f${i} } from ${JSON.stringify(path.join(ROOT, 'lib/features', n + '.js'))}\n`).join('') + (names.length ? `Validator.use(${names.map((_, i) => 'f' + i).join(', ')})\n` : '') + 'export { Validator }\n'
    const r = await esbuild.build({ stdin: { contents: src, resolveDir: ROOT }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' })
    return Object.keys(r.metafile.inputs).some((f) => f.endsWith('lib/safe-regex.js'))
  }
  // removeAdditional and coerceTypes reach lib/defaults.js through
  // lib/mutators.js and lib/remove-additional.js, which the full entries and
  // 1.x share, and lib/defaults.js requires the engine: a page with either
  // carries it as before.
  const SHARED = ['patterns', 'removeAdditional', 'coerceTypes', 'codegen']
  const others = Object.keys(F).filter((n) => isObj(F[n]) && !SHARED.includes(n))
  assert.strictEqual(await carries([]), false, 'the core alone leaves out lib/safe-regex.js')
  for (const n of others) assert.strictEqual(await carries([n]), false, 'the core with ' + n + ' leaves out lib/safe-regex.js')
  assert.strictEqual(await carries(others), false, 'the core with every feature but patterns leaves out lib/safe-regex.js')
  assert.strictEqual(await carries(['patterns']), true)

  console.log(`ok: ${pats.size} patterns, ${linear} needing the engine, the same answer from featuresFor() and compilePattern; ${named} schemas refused without patterns and answered as the full entry with it (${standards} through ~standard too), ${plain} with linear patterns only answered without it${store.length ? '' : ' (no SchemaStore checkout)'}; ${skipped} refused for other reasons; the passes refuse loudly; ${others.length + 1} core bundles leave out lib/safe-regex.js`)
  void platform
})().catch((e) => { console.error(e); process.exit(1) })
