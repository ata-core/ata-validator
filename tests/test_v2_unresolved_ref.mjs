// A $ref (or $dynamicRef) that resolves to nothing has an unknown verdict.
// Failing it in place is sound wherever a failure can only reject: allOf,
// anyOf, properties and the other keywords that apply a subschema to a value.
// Under not, an if condition, a oneOf branch, a contains with maxContains, or
// a node with unevaluated*, a failure can be inverted, and
// `{not: {$ref: 'missing.json'}}` accepted every value. The 2.0 entries
// refuse such a schema when they build an engine for it, at the first call,
// with "ata2: cannot resolve $ref X": the small engine, the verdict
// core and ata-validator/ir read it alike (lib/engine-small.js inverted()), so
// no verdict depends on the order a value's properties come in. A reference
// where failing it can only reject keeps failing in place, and the verdict
// core keeps such a schema.
//
// Every 2.0 path is held to it: the edge entry, the browser entry, the
// plugin's core with the features featuresFor() names and, where it names
// none, with none, the JSON text entry points, `~standard`, the verdict core,
// the full small engine and ata-validator/ir. The mutants at the end show the
// cases catch the old behaviour coming back.

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIB = path.join(ROOT, 'lib')
const F = await import(pathToFileURL(path.join(ROOT, 'index.v2.features.mjs')).href)
const { Validator: Edge } = await import(pathToFileURL(path.join(ROOT, 'index.v2.edge.mjs')).href)
const { Validator: Browser } = await import(pathToFileURL(path.join(ROOT, 'index.v2.browser.mjs')).href)
const { specialize } = await import(pathToFileURL(path.join(ROOT, 'lib/ir/index.mjs')).href)
const { createVerdict } = require(path.join(LIB, 'core/verdict.js'))
const full = require(path.join(LIB, 'engine-full.js'))

let passed = 0
function check (name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

// The plugin's core with a set of features, each set on its own copy of the
// registry and the engine that reads it (as tests/test_v2_core_features.js).
const FRESH = ['validator-small.js', 'groups.js', 'engine-small.js'].map((f) => path.join(LIB, f))
const cores = new Map()
function coreWith (names) {
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

const D2020 = 'https://json-schema.org/draft/2020-12/schema'
const D7 = 'http://json-schema.org/draft-07/schema#'
const REFS = ['missing.json', '#/$defs/nope']

// Each context with a document that reaches the reference R, and either the
// path the refusal names (the reference stands where failing it could
// accept) or the verdict, which is the one d7da9f2 gave.
const CONTEXTS = [
  ['not', (R) => ({ not: R }), 1, '/not'],
  ['if', (R) => ({ if: R, then: { type: 'string' } }), 1, '/if'],
  ['if alone', (R) => ({ if: R }), 1, '/if'],
  ['then', (R) => ({ if: { type: 'number' }, then: R }), 1, false],
  ['else', (R) => ({ if: { type: 'string' }, else: R }), 1, false],
  ['oneOf', (R) => ({ oneOf: [{ type: 'string' }, R] }), 'x', '/oneOf/1'],
  ['oneOf after two passing branches', (R) => ({ oneOf: [{}, {}, R] }), 1, '/oneOf/2'],
  ['anyOf after a passing branch', (R) => ({ anyOf: [{ type: 'string' }, R] }), 'x', true],
  ['anyOf, the reference first', (R) => ({ anyOf: [R, { type: 'string' }] }), 'x', true],
  ['anyOf, no branch passes', (R) => ({ anyOf: [{ type: 'string' }, R] }), 1, false],
  ['anyOf whose later branch negates it', (R) => ({ anyOf: [{ type: 'string' }, { not: R }] }), 'x', '/anyOf/1/not'],
  ['allOf', (R) => ({ allOf: [{ type: 'string' }, R] }), 'x', false],
  ['allOf after a failing branch, under not', (R) => ({ not: { allOf: [{ type: 'number' }, R] } }), 'x', '/not/allOf/1'],
  ['contains', (R) => ({ contains: R }), [1], false],
  ['contains with maxContains', (R) => ({ contains: R, maxContains: 1 }), [1], '/contains'],
  ['contains under not', (R) => ({ not: { contains: R } }), [1], '/not/contains'],
  ['dependentSchemas', (R) => ({ dependentSchemas: { a: R } }), { a: 1 }, false],
  ['dependentSchemas under not', (R) => ({ not: { dependentSchemas: { a: R } } }), { a: 1 }, '/not/dependentSchemas/a'],
  ['propertyNames', (R) => ({ propertyNames: R }), { a: 1 }, false],
  ['unevaluatedProperties', (R) => ({ unevaluatedProperties: R }), { a: 1 }, '/unevaluatedProperties'],
  ['beside unevaluatedProperties', (R) => ({ anyOf: [{ properties: { a: R } }, {}], unevaluatedProperties: false }), { a: 1 }, '/anyOf/0/properties/a'],
  ['unevaluatedItems', (R) => ({ unevaluatedItems: R }), [1], '/unevaluatedItems'],
  ['properties', (R) => ({ properties: { a: R } }), { a: 1 }, false],
  ['properties under not', (R) => ({ not: { properties: { a: R } } }), { a: 1 }, '/not/properties/a'],
  ['a property named not', (R) => ({ properties: { not: R } }), { not: 1 }, false],
  ['patternProperties', (R) => ({ patternProperties: { '^a': R } }), { a: 1 }, false],
  ['additionalProperties', (R) => ({ additionalProperties: R }), { a: 1 }, false],
  ['items', (R) => ({ items: R }), [1], false],
  ['prefixItems under not', (R) => ({ not: { prefixItems: [R] } }), [1], '/not/prefixItems/0'],
  ['behind a reference that resolves, positive', (R) => ({ $ref: '#/$defs/a', $defs: { a: { properties: { p: R } } } }), { p: 1 }, false],
  ['behind a reference that resolves, under not', (R) => ({ $ref: '#/$defs/a', $defs: { a: { not: R } } }), 1, '/$ref/not'],
  ['under not through a reference that resolves', (R) => ({ not: { $ref: '#/$defs/a' }, $defs: { a: { properties: { p: R } } } }), { p: 1 }, '/not/$ref/properties/p'],
  ['two negations', (R) => ({ not: { not: R } }), 1, '/not/not'],
  ['draft-07 dependencies', (R) => ({ $schema: D7, dependencies: { a: R } }), { a: 1 }, false],
  ['a definition nothing references, under not', (R) => ({ type: 'integer', $defs: { x: { not: R } } }), 1, true],
]

// [label, schema, document, ref, keyword, where (path) or verdict]
const CASES = []
for (const ref of REFS) {
  for (const [label, make, doc, answer] of CONTEXTS) {
    const s = make({ $ref: ref })
    CASES.push([`${label}, ${ref}`, s.$schema ? s : { $schema: D2020, ...s }, doc, ref, '$ref', answer])
  }
}
CASES.push(['not, $dynamicRef to no anchor', { $schema: D2020, not: { $dynamicRef: '#nope' } }, 1, '#nope', '$dynamicRef', '/not'])
CASES.push(['if, $dynamicRef to no anchor', { $schema: D2020, if: { $dynamicRef: '#nope' }, then: { type: 'string' } }, 1, '#nope', '$dynamicRef', '/if'])
CASES.push(['properties, $dynamicRef to no anchor', { $schema: D2020, properties: { a: { $dynamicRef: '#nope' } } }, { a: 1 }, '#nope', '$dynamicRef', false])

// A oneOf the verdict core dispatches by its `kind` tag: the reference sits
// in the branch the tag rules out, and the small engine met it or not by the
// order of the value's keys. Refused at build, whatever the order.
const TAGGED = { oneOf: [
  { type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
  { type: 'object', properties: { kind: { const: 'b' }, x: { $ref: '#/$defs/nope' } }, required: ['kind'] },
] }
CASES.push(['a oneOf dispatched by tag', TAGGED, { x: 1, kind: 'a' }, '#/$defs/nope', '$ref', '/oneOf/1/properties/x'])

// SchemaStore minecraft-texture-mcmeta (draft-07): the reference at oneOf/1
// names a document that is not registered.
const MINECRAFT = {
  $schema: D7,
  $id: 'https://json.schemastore.org/minecraft-texture-mcmeta.json',
  oneOf: [
    { properties: { animation: { type: 'object', properties: { interpolate: { type: 'boolean', default: false }, frametime: { type: 'integer', default: 1 } } } }, required: ['animation'] },
    { properties: { fusion: { $ref: 'partial-fusion-texture-metadata.json#/definitions/fusion-properties' } }, required: ['fusion'] },
  ],
  type: 'object',
}
CASES.push(['SchemaStore minecraft-texture-mcmeta', MINECRAFT, { animation: { frametime: 8 } }, 'partial-fusion-texture-metadata.json#/definitions/fusion-properties', '$ref', '/oneOf/1/properties/fusion'])

const refused = (c) => typeof c[5] === 'string'
const message = (c) => `ata2: cannot resolve ${c[4]} ${c[3]}`
const names = (r) => r.errors.map((e) => e.keyword).join(',')

// The entries, each a factory: [name, (schema) => Validator class].
const ENTRIES = [
  ['edge', () => Edge],
  ['browser', () => Browser],
  ['plugin core, featuresFor()', (s) => coreWith(F.featuresFor(s))],
  ['plugin core, featuresFor() and standardSchema', (s) => coreWith(F.featuresFor(s).concat('standardSchema'))],
]
const entriesFor = (s) => F.featuresFor(s).length === 0 ? ENTRIES.concat([['plugin core, no feature', () => coreWith([])]]) : ENTRIES

console.log('2.0: a reference that resolves to nothing where failing it could accept is refused at build\n')

check(`${CASES.filter(refused).length} refused cases: every entry and call throws the refusal, whichever call is first`, () => {
  for (const c of CASES.filter(refused)) {
    const [label, s, d] = c
    for (const [name, of] of entriesFor(s)) {
      const V = of(s)
      for (const calls of [['isValidObject', 'validate', 'isValidJSON', 'validateJSON'], ['validate', 'isValidObject', 'validateJSON', 'isValidJSON'], ['validateJSON'], ['isValidJSON']]) {
        const v = new V(s)
        for (const call of calls) {
          const arg = call.endsWith('JSON') ? JSON.stringify(d) : structuredClone(d)
          assert.throws(() => v[call](arg), { message: message(c) }, `${label}: ${name} ${call} after ${calls.slice(0, calls.indexOf(call)).join(', ') || 'nothing'}`)
        }
      }
      if (!name.startsWith('plugin core') || name.endsWith('standardSchema')) assert.throws(() => new V(s)['~standard'].validate(structuredClone(d)), { message: message(c) }, `${label}: ${name} ~standard`)
    }
  }
})

check(`${CASES.filter((c) => !refused(c)).length} kept cases: the verdict d7da9f2 gave, a reference that resolves to nothing failing in place`, () => {
  let bare = 0
  for (const c of CASES.filter((x) => !refused(x))) {
    const [label, s, d, , , valid] = c
    for (const [name, of] of entriesFor(s)) {
      if (name === 'plugin core, no feature') bare++
      const V = of(s)
      const a = new V(s)
      assert.strictEqual(a.isValidObject(structuredClone(d)), valid, `${label}: ${name} isValidObject`)
      const r = a.validate(structuredClone(d))
      assert.strictEqual(r.valid, valid, `${label}: ${name} validate, got ${r.valid ? 'valid' : names(r)}`)
      const b = new V(s)
      assert.strictEqual(b.validate(structuredClone(d)).valid, valid, `${label}: ${name} validate first`)
      assert.strictEqual(b.isValidJSON(JSON.stringify(d)), valid, `${label}: ${name} isValidJSON`)
      assert.strictEqual(b.validateJSON(JSON.stringify(d)).valid, valid, `${label}: ${name} validateJSON`)
      if (!name.startsWith('plugin core') || name.endsWith('standardSchema')) assert.strictEqual(!new V(s)['~standard'].validate(structuredClone(d)).issues, valid, `${label}: ${name} ~standard`)
    }
  }
  assert.ok(bare > 20, `${bare} cases on a core with no feature`)
})

check('a reference into a document registered with addSchema() before the first call is not refused', () => {
  const s = { not: { $ref: 'https://example.com/b.json' } }
  const b = { $id: 'https://example.com/b.json', type: 'string' }
  for (const [name, of] of ENTRIES.slice(0, 2)) {
    const v = new (of(s))(s)
    v.addSchema(b)
    assert.strictEqual(v.isValidObject(1), true, name)
    assert.strictEqual(v.isValidObject('x'), false, name)
    assert.throws(() => new (of(s))(s).isValidObject(1), { message: 'ata2: cannot resolve $ref https://example.com/b.json' }, `${name} without it`)
  }
})

check('the verdict core and the full small engine refuse exactly the refused cases, and the core keeps the others', () => {
  let kept = 0
  for (const c of CASES) {
    const [label, s, d] = c
    // The engines take a 2020-12 schema; a draft-07 one is normalized by the
    // Validator first, and held to it above.
    if (s.$schema === D7) continue
    const n = s
    if (refused(c)) {
      assert.throws(() => createVerdict(n, { schemaMap: null }), { message: message(c) }, `${label}: the core`)
      assert.throws(() => full.createSmall(n, { schemaMap: null }), { message: message(c) }, `${label}: the small engine`)
    } else {
      const v = createVerdict(n, { schemaMap: null })
      assert.strictEqual(typeof v, 'function', `${label}: the core keeps it`)
      assert.strictEqual(v(structuredClone(d)), c[5], `${label}: the core's verdict`)
      kept++
    }
  }
  assert.ok(kept >= 25, `${kept} kept by the core`)
})

const KERNELS = pathToFileURL(path.join(ROOT, 'lib/kernels/index.mjs')).href
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-v2-unresolved-')))
let seq = 0
const load = async (src) => { const f = path.join(tmp, `m${seq++}.mjs`); fs.writeFileSync(f, src.replace(/(['"])ata-validator\/kernels\1/g, () => JSON.stringify(KERNELS))); return import(pathToFileURL(f).href) }

try {
  let compiled = 0
  for (const c of CASES) {
    const [label, s, d] = c
    for (const opts of [{ verdict: true }, {}]) {
      // A $dynamicRef to no anchor the ir already refused, with its own message.
      if (refused(c)) { assert.throws(() => specialize(s, opts), { message: c[4] === '$ref' ? message(c).replace(/^ata2: /, 'ir: ') : /^ir: / }, `${label}: ata-validator/ir refuses it`); continue }
      // ata-validator/ir refuses any $dynamicRef to no anchor, as before.
      if (c[4] === '$dynamicRef') { assert.throws(() => specialize(s, opts), /^Error: ir: /); continue }
      const m = await load(specialize(s, opts))
      assert.strictEqual(m.isValid(structuredClone(d)), c[5], `${label}: module isValid`)
      assert.strictEqual(m.validate(structuredClone(d)).valid, c[5], `${label}: module validate`)
      compiled++
    }
  }
  check(`ata-validator/ir refuses the refused cases with the same message, and compiles the others (${compiled} modules)`, () => assert.ok(compiled >= 40))
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

// The small engine skips the walk for a flat schema whose references all
// resolve by the resolver's own pointer walk; it may only ever conclude that
// a reference resolves. Each pointer here, under not, is refused exactly when
// the resolver finds nothing.
const { indexSchemas, resolveRef } = require(path.join(LIB, 'engine-shared.js'))
const POINTERS = ['#/$defs/a', '#/$defs/nope', '#', '#/items/0', '#/items/1', '#/items/01', '#/items/length', '#/items/-', '#/constructor', '#/$defs/a/constructor', '#/a%25b', '#/a~1b', '#/a~0b', '#/a b', '#//', '#/$defs/', '#/$defs/a.b', '#/$defs/x-y', '#/$defs/$z']
const pointerSchema = (p) => ({ not: { $ref: p }, items: [{}], $defs: { a: { type: 'string' }, 'a.b': {}, 'x-y': {}, $z: {} }, 'a%b': {}, 'a/b': {}, 'a~b': {}, 'a b': {} })
check(`${POINTERS.length} pointers: refused exactly where the resolver finds nothing, through the shortcut or the walk`, () => {
  for (const p of POINTERS) {
    const s = pointerSchema(p)
    const missing = resolveRef(p, 'ata://root', indexSchemas(s, null, true)).node === undefined
    let refused = false
    try { full.createSmall(s, { schemaMap: null, flat: true }) } catch (e) { assert.match(e.message, /^ata2: cannot resolve/); refused = true }
    assert.strictEqual(refused, missing, `${p}: refused ${refused}, the resolver finds ${missing ? 'nothing' : 'it'}`)
  }
})

// Mutants: each puts back what a path did before, and the cases above must
// tell it apart. A module compiled from altered source, as a file of lib/ so
// its own requires resolve.
function loadMutant (file, from, to) {
  const file_ = path.join(LIB, file)
  const src = fs.readFileSync(file_, 'utf8')
  assert.ok(src.includes(from), `${file}: the mutated text is there: ${from}`)
  const name = path.join(path.dirname(file_), 'mutant-' + path.basename(file))
  const m = new Module(name)
  m.filename = name
  m.paths = Module._nodeModulePaths(path.dirname(file_))
  m._compile(src.split(from).join(to), name)
  return m.exports
}
const byLabel = (prefix) => CASES.filter((x) => x[4] === '$ref' && x[0].startsWith(prefix + ','))
const NOT_IF = () => [...byLabel('not'), ...byLabel('if')]

check('mutant: the small engine building a schema it should refuse accepts', () => {
  const mutant = loadMutant('engine-full.js', ')) inverted(root, state, opts.v1)', ')) 0')
  for (const [label, s, d] of NOT_IF()) assert.strictEqual(mutant.createSmall(s, { schemaMap: null }).isValid(d), true, `${label}: the mutant accepts, so this case catches it`)
})

check('mutant: the walk taking not for a positive keyword', () => {
  const mutant = loadMutant('engine-full.js', 'const KIND = { not: -1, ', 'const KIND = { ')
  for (const [label, s, d] of byLabel('not')) assert.strictEqual(mutant.createSmall(s, { schemaMap: null }).isValid(d), true, `${label}: the mutant accepts, so this case catches it`)
})

check('mutant: the walk taking a property named not for the keyword', () => {
  const mutant = loadMutant('engine-full.js', 'const c = m ? 0 : KIND[k] | 0', 'const c = KIND[k] | 0')
  for (const [label, s] of byLabel('a property named not')) assert.throws(() => mutant.createSmall(s, { schemaMap: null }), /ata2: /, `${label}: the mutant refuses it, so this case catches it`)
})

check('mutant: the shortcut taking a pointer the resolver finds nothing at for one that resolves', () => {
  const mutant = loadMutant('engine-full.js', "walkPointer(root, m[1].slice(1)) !== undefined", 'true')
  let caught = 0
  for (const p of POINTERS) {
    const s = pointerSchema(p)
    if (resolveRef(p, 'ata://root', indexSchemas(s, null, true)).node !== undefined) continue
    let refused = false
    try { mutant.createSmall(s, { schemaMap: null, flat: true }) } catch { refused = true }
    if (!refused) caught++
  }
  assert.ok(caught >= 3, `${caught} missing pointers the mutant skips, so these cases catch it`)
})

check('mutant: the verdict core building a schema it should refuse accepts', () => {
  const mutant = loadMutant('core/verdict.js', '!none++) inverted(root, state, opts.v1)', '!none++) 0')
  for (const [label, s, d] of NOT_IF()) assert.strictEqual(mutant.createVerdict(s, {})(d), true, `${label}: the mutant accepts, so this case catches it`)
})

console.log(`\n${passed} passed, 0 failed`)
