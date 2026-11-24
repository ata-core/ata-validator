'use strict'

// A name that is also a keyword, used as a name. In `properties`,
// `patternProperties`, `dependentSchemas`, `dependentRequired`, `dependencies`,
// `propertyDependencies` and a definition container, a key is a name, whatever
// it spells: `$id` there is a property called `$id`, `const` a property called
// `const`. Three walks tested a key against a keyword without asking where the
// key sat:
//
// - The copy that turns every reference into a local one (normalizeRefsWalk in
//   lib/js-compiler.js) dropped every `$id` below the root. A property named
//   `$id` lost its schema, so generated code and the modules checked nothing
//   for it. The draft-07 and draft-06 meta-schemas constrain exactly that
//   property: `new Validator({ $ref: <draft-07> }).isValidObject({ $id: 'a b' })`
//   was true, where the interpreted engine refuses it (`format: uri-reference`).
//   With `additionalProperties: false` the same drop refused a valid document.
// - canResolveDynamicRefs called a string method on `$dynamicRef` wherever the
//   key appeared, and threw a TypeError for a name spelled that way in a
//   document reached through a reference.
// - The walk that sends a schema with a reference that names nothing away from
//   the native reader (refersBack in lib/buffer-gate.js) skipped `enum`,
//   `const`, `default` and `examples` as values under a name map too, so it
//   did not see a reference behind a property with one of those names.
//
// The oracle is the interpreted engine. Every path scripts/gate.js knows is
// held to it, with the JSON text readers short and past 8 KB, the buffer
// readers, the first call of a new validator, and ata-validator/compat. The
// same cases run again in a child process with the small twin on. The
// mutants at the end put each old line back and show these cases catch it.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { spawnSync } = require('node:child_process')

const TWIN = process.argv[2] === 'twin'
const ROOT = path.join(__dirname, '..')
const LIB = path.join(ROOT, 'lib')
// scripts/gate.js turns the small twin off for its process; the child run
// leaves it on and takes the paths below without the gate's.
const gate = TWIN ? null : require(path.join(ROOT, 'scripts/gate.js'))
const { Validator } = require(ROOT)
const Compat = (() => { const c = require(path.join(ROOT, 'compat.js')); return c.default || c })()
const { METASCHEMAS } = require(path.join(LIB, 'metaschemas'))
const realCompiler = require(path.join(LIB, 'js-compiler'))
const { bufferNeedsSlowPath } = require(path.join(LIB, 'buffer-gate'))

const D4 = 'http://json-schema.org/draft-04/schema#'
const D6 = 'http://json-schema.org/draft-06/schema#'
const D7 = 'http://json-schema.org/draft-07/schema#'
const D2019 = 'https://json-schema.org/draft/2019-09/schema'
const D2020 = 'https://json-schema.org/draft/2020-12/schema'

const J = (d) => JSON.stringify(d)
const long = (t) => t + ' '.repeat(9000)
const clone = (d) => structuredClone(d)
const padded = (t) => { const b = Buffer.from(t); const p = Buffer.alloc(b.length + 64); b.copy(p); return [p, b.length] }

// The paths beside the gate's. `o` is the registry a case brings, or undefined.
const compatFn = (s, interpreted) => {
  const a = new Compat({ strict: false, validateSchema: false, validateFormats: true })
  if (interpreted) { const f = a._validatorOptions; a._validatorOptions = function () { const r = f.call(this); r.engine = 'interpreter'; return r } }
  return a.compile(s)
}
const V = (s, o, more) => new Validator(s, { ...(o || {}), ...(more || {}) })
const both = (v) => ({ isValid: (d) => v.isValidObject(d), validate: (d) => v.validate(d).valid })
const EXTRA = {
  'first call': { each: 5, build: (s, o) => ({ isValid: (d) => V(s, o).isValidObject(d), validate: (d) => V(s, o).validate(d).valid }) },
  'first call, JSON text': { each: 5, build: (s, o) => ({ isValid: (d) => V(s, o).isValidJSON(J(d)), validate: (d) => V(s, o).validateJSON(J(d)).valid }) },
  'default options': { build: (s, o) => both(V(s, o)) },
  'assertFormat: true': { build: (s, o) => both(V(s, o, { assertFormat: true })) },
  'useDefaults: false': { build: (s, o) => both(V(s, o, { useDefaults: false })) },
  'richErrors: false': { build: (s, o) => both(V(s, o, { richErrors: false })) },
  'JSON text past 8 KB': { build: (s, o) => { const v = V(s, o); return { isValid: (d) => v.isValidJSON(long(J(d))), validate: (d) => v.validateJSON(long(J(d))).valid } } },
  'isValid(Buffer), short and long': { build: (s, o) => { const v = V(s, o); return { isValid: (d) => v.isValid(Buffer.from(J(d))), validate: (d) => v.isValid(Buffer.from(long(J(d)))) } } },
  'isValid(string) and validateAndParse': { build: (s, o) => { const v = V(s, o); return { isValid: (d) => v.isValid(J(d)), validate: (d) => v.validateAndParse(Buffer.from(long(J(d)))).valid } } },
  'countValid and batchIsValid': { build: (s, o) => { const v = V(s, o); return { isValid: (d) => v.countValid(Buffer.from(J(d) + '\n')) === 1, validate: (d) => v.batchIsValid([Buffer.from(J(d))]) === 1 } } },
  'isValidNDJSON and isValidParallel': { build: (s, o) => { const v = V(s, o); return { isValid: (d) => v.isValidNDJSON(Buffer.from(J(d) + '\n'))[0] === true, validate: (d) => v.isValidParallel(Buffer.from(J(d) + '\n'))[0] === true } } },
  'isValidPrepadded, short and long': { build: (s, o) => { const v = V(s, o); return { isValid: (d) => v.isValidPrepadded(...padded(J(d))), validate: (d) => v.isValidPrepadded(...padded(long(J(d)))) } } },
  // compat reads a schema its own way (draft-07 unless said), so it is held to itself on the interpreted engine.
  'ata-validator/compat': { noRegistry: true, oracle: (s) => compatFn(s, true), build: (s) => { const f = compatFn(s, false); return { isValid: (d) => f(d), validate: (d) => f(d) } } },
}
const GATE = {}
if (gate !== null) for (const [name, P] of Object.entries(gate.PATHS)) GATE[name] = { noRegistry: true, async: P.async, build: (s) => { const p = P.async ? P.build(s) : P.build(s); const wrap = (q) => (q === null ? null : { isValid: (d) => q.isValid(d), validate: (d) => q.validate(d).valid }); return P.async ? p.then(wrap) : wrap(p) } }
const PATHS = { ...GATE, ...EXTRA }

const stats = {}
const diffs = []
let schemas = 0; let documents = 0; let refused = 0
// One schema on every path. `expect`, where given, is what the oracle must say for each document.
async function check (label, schema, docs, registry, expect) {
  const oracle = new Validator(schema, { ...(registry || {}), engine: 'interpreter' })
  const want = docs.map((d) => oracle.validate(clone(d)).valid)
  if (expect) assert.deepStrictEqual(want, expect, `${label}: the interpreted engine's own answers`)
  schemas++; documents += docs.length; refused += want.filter((x) => x === false).length
  for (const [name, P] of Object.entries(PATHS)) {
    if (registry && P.noRegistry) continue
    const st = stats[name] || (stats[name] = { taken: 0, declined: 0, docs: 0 })
    let p
    try { p = P.async ? await P.build(schema, registry) : P.build(schema, registry) } catch (e) { diffs.push(`${name} | ${label} | building threw: ${String(e && e.message).slice(0, 120)}`); continue }
    if (p === null) { st.declined++; continue }
    st.taken++
    const mine = P.oracle ? (() => { const f = P.oracle(schema); return docs.map((d) => f(clone(d))) })() : want
    for (let i = 0; i < docs.length; i++) {
      if (P.each && i % P.each !== 0) continue
      st.docs++
      let a; let b
      try { a = p.validate(clone(docs[i])); b = p.isValid(clone(docs[i])) } catch (e) { diffs.push(`${name} | ${label} | threw on ${J(docs[i]).slice(0, 80)}: ${String(e && e.message).slice(0, 120)}`); continue }
      if (a !== mine[i] || b !== mine[i]) diffs.push(`${name} | ${label} | ${J(docs[i]).slice(0, 80)}: the interpreted engine says ${mine[i]}, this path ${a} and ${b}`)
    }
  }
}

// ---------------------------------------------------------------------------
// The vendored meta-schemas, each through `$ref`, under its own `$schema`,
// under another dialect's, and behind a property.

// The properties of a meta-schema that hold a format or a reference, however deep.
const carriers = (meta) => Object.keys(meta.properties || {}).filter((k) => /"(?:format|\$ref|\$dynamicRef|\$recursiveRef)":/.test(J(meta.properties[k])))
const BAD = ['a b', '(', 5, -1, [], [1, 1], { '(': {} }, { a: 5 }, { a: { $id: 'a b' } }, [{ $ref: 'a b' }], 'http://x/y']
function metaDocs (meta) {
  const docs = [{}, true, 1]
  for (const k of carriers(meta)) for (const b of BAD) docs.push({ [k]: b }, { properties: { p: { [k]: b } } })
  return docs
}
async function metaSchemas () {
  let carried = 0
  for (const [id, meta] of METASCHEMAS) {
    const docs = metaDocs(meta)
    carried += carriers(meta).length
    const own = typeof meta.$schema === 'string' ? meta.$schema : id
    await check(`$ref ${id}`, { $ref: id }, docs)
    await check(`$schema and $ref ${id}`, { $schema: own, $ref: id }, docs)
    await check(`another $schema, $ref ${id}`, { $schema: own.includes('2020-12') ? D7 : D2020, $ref: id }, docs)
    await check(`a property with $ref ${id}`, { properties: { s: { $ref: id } } }, docs.map((d) => ({ s: d })))
  }
  return carried
}

// ---------------------------------------------------------------------------
// Names that are keywords, in each kind of name map, in each place a walk
// that rewrites or reads the schema reaches.

const NAMES = ['$id', '$ref', '$dynamicRef', 'const', 'default', 'plainName']
const E = 'http://e.test/'
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) { if (k === 'allOf' && Array.isArray(o.allOf)) o.allOf = o.allOf.concat(v); else if (isObj(v) && isObj(o[k]) && ['$defs', 'definitions', 'properties'].includes(k)) o[k] = { ...o[k], ...v }; else o[k] = v } return o }
function bodies (N, dk, idKey) {
  const C = { type: 'string', maxLength: 1 }
  return {
    'properties': { properties: { [N]: C } },
    'properties, a format': { properties: { [N]: { type: 'string', format: 'uri-reference' } } },
    'properties, a reference': { [dk]: { short: C }, properties: { [N]: { $ref: '#/' + dk + '/short' } } },
    'properties, a reference that names nothing': { properties: { [N]: { $ref: '#/' + dk + '/missing' } } },
    'properties, a reference by URI': { [dk]: { s: { [idKey]: E + 's', ...C } }, properties: { [N]: { $ref: E + 's' } } },
    'closed properties': { properties: { [N]: true }, additionalProperties: false },
    'dependentSchemas': { dependentSchemas: { [N]: { required: ['zz'] } } },
    'dependentRequired': { dependentRequired: { [N]: ['zz'] } },
    'dependencies, a schema': { dependencies: { [N]: { required: ['zz'] } } },
    'dependencies, names': { dependencies: { [N]: ['zz'] } },
    'propertyDependencies': { propertyDependencies: { [N]: { v: { required: ['zz'] } } } },
    'a definition by that name': { [dk]: { [N]: C }, properties: { p: { $ref: '#/' + dk + '/' + N } } },
  }
}
function contexts (T, dk, idKey, dialect) {
  const out = {
    'alone': T,
    'beside a reference by URI': merge({ [idKey]: E + 'root', [dk]: { other: { [idKey]: E + 'other', type: 'object' } }, allOf: [{ $ref: E + 'other' }] }, T),
    'in an embedded resource': { [dk]: { m: merge({ [idKey]: E + 'm' }, T) }, allOf: [{ $ref: E + 'm' }] },
    'beside a deep pointer': merge({ [dk]: { w: { properties: { q: { type: 'object' } } } }, allOf: [{ $ref: '#/' + dk + '/w/properties/q' }] }, T),
    'a reference to itself by URI': merge({ [idKey]: E + 'r', properties: { child: { $ref: E + 'r' } } }, T),
    'under a property': { properties: { o: T } },
  }
  if (dialect === null || dialect === D2020) out['beside a dynamic reference'] = merge({ $defs: { leaf: { $dynamicAnchor: 'x', type: 'object' } }, allOf: [{ $dynamicRef: '#x' }] }, T)
  return out
}
const nameDocs = (N) => { const base = [{ [N]: 'toolong' }, { [N]: 'a' }, { [N]: 'a b' }, { [N]: 1 }, { [N]: 1, zz: 1 }, { [N]: 'v' }, { p: 'toolong' }, { p: 'a' }, {}, { other: 1 }, { [N]: {} }]; return base.concat(base.map((b) => ({ o: b })), base.slice(0, 5).map((b) => ({ child: b }))) }
async function names () {
  // Every name in draft-07 and with no dialect said; the other dialects on the names the three walks read.
  const DIALECTS = [[null, '$defs', '$id', NAMES], [D7, 'definitions', '$id', ['$id', '$ref', 'const']], [D2020, '$defs', '$id', ['$id', '$dynamicRef']], [D2019, '$defs', '$id', ['$id']], [D6, 'definitions', '$id', ['$id']], [D4, 'definitions', 'id', ['$id', 'id']]]
  for (const [dialect, dk, idKey, list] of DIALECTS) {
    for (const N of list) {
      const docs = nameDocs(N)
      for (const [bn, T] of Object.entries(bodies(N, dk, idKey))) {
        for (const [cn, S] of Object.entries(contexts(T, dk, idKey, dialect))) await check(`${dialect || 'no $schema'} | ${N} | ${bn} | ${cn}`, dialect === null ? S : { $schema: dialect, ...S }, docs)
        const reg = merge({ [idKey]: E + 'reg' }, T); if (dialect !== null) reg.$schema = dialect
        await check(`${dialect || 'no $schema'} | ${N} | ${bn} | a registered document`, dialect === null ? { $ref: E + 'reg' } : { $schema: dialect, $ref: E + 'reg' }, docs, { schemas: [reg] })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// What was reported, with the answers written out.

async function pinned () {
  const idDocs = [{ $id: 'a b' }, { $id: 'http://x/y' }, { $id: 5 }, { properties: { a: { $id: 'a b' } } }, { items: { $id: 'a b' } }, { $ref: 'a b' }, { $schema: 'a b' }, { pattern: '(' }, { format: 5 }, {}]
  const idWant = [false, true, false, false, false, false, false, false, false, true]
  for (const meta of [D7, D6]) {
    await check(`pinned: $ref ${meta}`, { $ref: meta }, idDocs, undefined, idWant)
    await check(`pinned: $schema and $ref ${meta}`, { $schema: meta, $ref: meta }, idDocs, undefined, idWant)
  }
  await check('pinned: an embedded resource with a property named $id', { $defs: { m: { $id: E + 'm', properties: { $id: { type: 'string', maxLength: 1 } } } }, $ref: E + 'm' }, [{ $id: 'toolong' }, { $id: 'a' }], undefined, [false, true])
  await check('pinned: a registered document with a property named $id', { $ref: E + 'reg' }, [{ $id: 'a b' }, { $id: 'a' }], { schemas: [{ $schema: D7, $id: E + 'reg', properties: { $id: { type: 'string', format: 'uri-reference' } } }] }, [false, true])
  await check('pinned: closed properties, a property named $id', { $id: E + 'root', $defs: { other: { $id: E + 'other', type: 'object' } }, allOf: [{ $ref: E + 'other' }], properties: { $id: true }, additionalProperties: false }, [{ $id: 1 }, { other: 1 }], undefined, [true, false])
  await check('pinned: dependentRequired on a property named $id', { $id: E + 'root', $defs: { other: { $id: E + 'other', type: 'object' } }, allOf: [{ $ref: E + 'other' }], dependentRequired: { $id: ['zz'] } }, [{ $id: 1 }, { $id: 1, zz: 1 }], undefined, [false, true])
  // The 2020-12 core vocabulary meta-schema has a property named `$dynamicRef`.
  await check('pinned: a draft-07 root with $ref to the 2020-12 core vocabulary', { $schema: D7, $ref: 'https://json-schema.org/draft/2020-12/meta/core' }, [{}, { $dynamicRef: 5 }, { $dynamicRef: '#a' }], undefined, [true, false, true])
  await check('pinned: a registered document with a property dependency named $dynamicRef', { $ref: E + 'reg' }, [{ $dynamicRef: 'v' }, { $dynamicRef: 'v', zz: 1 }], { schemas: [{ $id: E + 'reg', propertyDependencies: { $dynamicRef: { v: { required: ['zz'] } } } }] }, [false, true])
  await check('pinned: a reference that names nothing behind a property named const', UNDER_CONST, [{ o: { const: 'a' } }, { o: { const: 'toolong' } }, {}], undefined, [false, false, true])
}
// The native reader binds this reference to the definition beside it; the JS
// engines read it against the root, where it names nothing.
const UNDER_CONST = { properties: { o: { $defs: { short: { type: 'string', maxLength: 1 } }, properties: { const: { $ref: '#/$defs/short' } } } } }

// ---------------------------------------------------------------------------
// Mutants: a module compiled from altered source, as a file of lib/ so its
// own requires resolve.

function loadMutant (file, from, to) {
  const src = fs.readFileSync(path.join(LIB, file), 'utf8')
  assert.strictEqual(src.split(from).length, 2, `${file}: the mutated text is there once: ${from}`)
  const m = new Module(path.join(LIB, 'mutant-' + file))
  m.filename = path.join(LIB, 'mutant-' + file)
  m.paths = Module._nodeModulePaths(LIB)
  m._compile(src.replace(from, () => to), m.filename)
  return m.exports
}
// What the Validator hands the generators for a schema.
const prepared = (s, o) => { const v = new Validator(s, o); v.isValidObject(null); return [v._schemaObj, v._schemaMap && v._schemaMap.size > 0 ? v._schemaMap : null] }

function mutants () {
  const D7_ID = [{ $ref: D7 }, undefined, { $id: 'a b' }]
  const ID_CASES = [
    D7_ID,
    [{ $ref: D6 }, undefined, { $id: 'a b' }],
    [{ $defs: { m: { $id: E + 'm', properties: { $id: { type: 'string', maxLength: 1 } } } }, $ref: E + 'm' }, undefined, { $id: 'toolong' }],
    [{ $id: E + 'root', $defs: { other: { $id: E + 'other', type: 'object' } }, allOf: [{ $ref: E + 'other' }], dependentRequired: { $id: ['zz'] } }, undefined, { $id: 1 }],
    [{ $ref: E + 'reg' }, { schemas: [{ $schema: D7, $id: E + 'reg', properties: { $id: { type: 'string', format: 'uri-reference' } } }] }, { $id: 'a b' }],
  ]
  const dropAll = loadMutant('js-compiler.js', "if (k === '$id' && node !== root && typeof node[k] === 'string') continue", "if (k === '$id' && node !== root) continue")
  for (const [s, o, d] of ID_CASES) {
    const [n, map] = prepared(s, o)
    // The verdict generator, and the closure compiler where it declines, as the Validator asks them.
    const real = realCompiler.compileToJSCodegen(n, map) || realCompiler.compileToJS(n, null, map)
    const mutant = dropAll.compileToJSCodegen(n, map) || dropAll.compileToJS(n, null, map)
    assert.strictEqual(typeof real, 'function', `${J(s)}: compiled`)
    assert.strictEqual(real(d), false, `${J(s)}: generated code refuses ${J(d)}`)
    assert.strictEqual(typeof mutant, 'function')
    assert.strictEqual(mutant(d), true, `${J(s)}: the mutant accepts ${J(d)}, so this case catches it`)
  }
  // The other two entry points compile from the same copy.
  {
    const [n, map] = prepared(...D7_ID.slice(0, 2))
    const keeps = (c) => J(c._internal.prepareForCodegen(n, map)).includes('"$id":{"type":"string","format":"uri-reference"}')
    assert.strictEqual(keeps(realCompiler), true, 'the copy the three generators compile from keeps the property named $id')
    assert.strictEqual(keeps(dropAll), false, 'the mutant copy has lost it')
  }

  const anyKey = loadMutant('js-compiler.js', "if (typeof s.$dynamicRef === 'string') {", 'if (s.$dynamicRef) {')
  for (const [s, o] of [[{ $schema: D7, $ref: 'https://json-schema.org/draft/2020-12/meta/core' }, undefined], [{ $ref: E + 'reg' }, { schemas: [{ $id: E + 'reg', propertyDependencies: { $dynamicRef: { v: { required: ['zz'] } } } }] }]]) {
    const [n, map] = prepared(s, o)
    // Each entry point as the Validator calls it; their signatures differ.
    const entries = (c) => [() => c.compileToJSCodegen(n, map), () => c.compileToJS(n, null, map), () => c.compileToJSCombined(n, { valid: true, errors: [] }, map), () => c.compileToJSCodegenWithErrors(n, map)]
    for (const f of entries(realCompiler)) assert.doesNotThrow(f, `${J(s)}: the generator answers or declines`)
    const threw = entries(anyKey).filter((f) => { try { f(); return false } catch (e) { return e instanceof TypeError } }).length
    assert.ok(threw > 0, `${J(s)}: the mutant throws a TypeError, so this case catches it`)
  }

  const skipsNames = loadMutant('buffer-gate.js', 'back = SUBSCHEMA_MAPS.includes(key) ? Object.values(v).some(visit) : visit(v);', 'back = visit(v);')
  for (const name of ['const', 'enum', 'default', 'examples']) {
    const s = { properties: { o: { properties: { [name]: { $ref: '#/$defs/missing' } } } } }
    assert.strictEqual(bufferNeedsSlowPath(s, null), true, `${name}: the schema is answered through validate()`)
    assert.strictEqual(skipsNames.bufferNeedsSlowPath(s, null), false, `${name}: the mutant hands it to the native reader, so this case catches it`)
  }
  assert.strictEqual(bufferNeedsSlowPath(UNDER_CONST, null), true)
  // As a value the same keys are still skipped: a reference inside a `const` is data.
  assert.strictEqual(bufferNeedsSlowPath({ properties: { a: { const: { $ref: '#/$defs/missing' } } } }, null), false)
}

;(async () => {
  if (gate !== null) await gate.loadIr()
  await pinned()
  const carried = await metaSchemas()
  await names()
  if (gate !== null) gate.cleanup()

  if (diffs.length) { console.log(`${diffs.length} differences:\n`); for (const d of diffs.slice(0, 20)) console.log('  ' + d) }
  assert.strictEqual(diffs.length, 0, 'a path answers differently from the interpreted engine')
  assert.strictEqual(METASCHEMAS.size, 18, 'every vendored meta-schema was read')
  assert.ok(carried > 100, `properties holding a format or a reference: ${carried}`)
  assert.ok(refused > 10000, `documents the interpreted engine refuses: ${refused}`)
  for (const name of Object.keys(PATHS)) assert.ok(stats[name] && stats[name].docs > 0, `${name} answered`)
  if (gate !== null) {
    assert.strictEqual(Object.keys(GATE).length, Object.keys(gate.PATHS).length)
    for (const name of ['generated code, warm', 'module', 'module, one pass', 'ir module', 'ir closures', 'closure tree']) assert.ok(stats[name].taken > 500, `${name} took ${stats[name].taken} schemas`)
    mutants()
    const child = spawnSync(process.execPath, [__filename, 'twin'], { encoding: 'utf8', env: { ...process.env, ATA_NO_SMALL_TWIN: '' } })
    assert.strictEqual(child.status, 0, 'the same cases with the small twin on:\n' + child.stdout + child.stderr)
    process.stdout.write(child.stdout)
  }
  console.log(`test_keyword_named_names${TWIN ? ' (small twin on)' : ''}: ${schemas} schemas, ${documents} documents, ${refused} refused by the interpreted engine, ${Object.keys(PATHS).length} paths, 0 differences${TWIN ? '' : '; 3 mutants caught'}`)
})().catch((e) => { console.error(e); process.exit(1) })
