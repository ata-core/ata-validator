'use strict'

// A document registered through `schemas` and reached by a cross-document
// $ref holds references of its own, resolved against that document's base
// URI. Until this test, generated code resolved them by string: an exact
// registry key, or any key ending in "/" + the reference. A reference the
// registry could not satisfy emitted no check at all, and a reference whose
// file name matched a document on another host bound to that document. The
// interpreted engine resolves against the real base and rejects both. So
// `{ plugins: 42 }` passed SchemaStore's mdxlintrc when it was registered and
// reached through `{ $ref: <its $id> }`, from 1.0.0 to 1.65.0.
//
// For every case below, every path either declines or gives the interpreted
// engine's answer: the four code generation entry points (on the raw schema
// and on the schema Validator prepares), the standalone emitters, and a
// Validator's validate, isValidObject, validateJSON, isValidJSON and
// isValid(buffer), on the first call and after the tier switch. Cases where
// the reference does resolve must still compile where they compiled before.

const path = require('path')
const Module = require('module')
const ROOT = path.join(__dirname, '..')
const { Validator } = require(ROOT)
const jc = require(ROOT + '/lib/js-compiler.js')
const aot = require(ROOT + '/lib/aot-impl.js')

const VALID_RESULT = { valid: true, errors: [] }

// tests/run.js turns the small twin off, so the first calls of a small schema
// run generated code. The twin, which answers those calls on the interpreted
// engine and switches tier later, is the default: run once more with it on.
if (process.env.ATA_NO_SMALL_TWIN && !process.env.ATA_REFRES_CHILD) {
  const env = { ...process.env, ATA_REFRES_CHILD: '1' }
  delete env.ATA_NO_SMALL_TWIN
  const r = require('child_process').spawnSync(process.execPath, [__filename], { env, stdio: 'inherit' })
  if (r.status !== 0) { console.log('FAIL with the small twin on'); process.exit(1) }
}
let failures = 0
let checks = 0
const fail = (msg) => { failures++; console.log('  FAIL ' + msg) }

// Each case is built under a base of its own, and each cold call builds it
// again under a new one, so no compile cache entry is reused and every cold
// call really is a first call.
let seq = 0
function cases() {
  const b = `https://example.com/c${seq++}/`
  const a = (ref) => ({ $id: b + 'a.json', type: 'object', properties: { p: { $ref: ref } } })
  const target = { $id: b + 'missing.json', definitions: { x: { type: 'string' } } }
  const other = { $id: `https://other.org/c${seq}/b.json`, type: 'string' }
  const wrong = { $id: b + 'a.json', properties: { p: { $ref: 'b.json' } } }
  // The SchemaStore shape: mdxlintrc and rehyperc extend remarkrc.json by a
  // relative pointer, and remarkrc is not registered.
  const mdx = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: b + 'mdxlintrc.json',
    type: 'object',
    properties: { plugins: { $ref: 'remarkrc.json#/properties/plugins' }, settings: { type: 'object' } },
  }
  // foundryvtt-module-manifest: a whole-document relative reference, inside allOf.
  const foundry = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: b + 'foundryvtt-module-manifest.json',
    allOf: [{ $ref: 'foundryvtt-base-package-manifest.json#' }, { properties: { library: { type: 'boolean' } } }],
  }
  const reg = (doc, extra = []) => ({ root: { $ref: doc.$id }, schemas: [doc, ...extra] })
  return [
    // name, { root, schemas }, documents, whether the reference resolves
    ['relative missing', reg(a('missing.json#/definitions/x')), [{ p: 1 }, { p: 's' }, {}], false],
    ['absolute missing', reg(a(b + 'missing.json#/definitions/x')), [{ p: 1 }, {}], false],
    ['local pointer missing', reg(a('#/definitions/nope')), [{ p: 1 }, {}], false],
    ['relative, target registered', reg(a('missing.json#/definitions/x'), [target]), [{ p: 1 }, { p: 's' }, {}, 3], true],
    ['relative, target registered, bad pointer', reg(a('missing.json#/definitions/zz'), [target]), [{ p: 1 }, {}], false],
    ['relative without fragment, target registered', reg(a('b.json'), [{ $id: b + 'b.json', type: 'string' }]), [{ p: 1 }, { p: 's' }], true],
    ['absolute, target registered', reg(a(b + 'b.json'), [{ $id: b + 'b.json', type: 'string' }]), [{ p: 1 }, { p: 's' }], true],
    ['wrong target, root is the document', { root: wrong, schemas: [other] }, [{ p: 1 }, { p: 's' }, {}], false],
    ['wrong target, reached by $ref', reg(wrong, [other]), [{ p: 1 }, { p: 's' }, {}], false],
    ['mdxlintrc shape', { root: { $schema: mdx.$schema, $ref: mdx.$id }, schemas: [mdx] }, [{ plugins: 42 }, { settings: 1 }, {}], false],
    ['foundryvtt shape', { root: { $schema: foundry.$schema, $ref: foundry.$id }, schemas: [foundry] }, [{}, { library: false }, { library: 1 }], false],
    // A fragment-only reference two documents away from the root: b.json has
    // no definitions, and the generators read it against the root's.
    ['local pointer two documents away', {
      root: { definitions: { nope: { type: 'number' } }, properties: { q: { $ref: b + 'a.json' } } },
      schemas: [{ $id: b + 'a.json', properties: { p: { $ref: b + 'b.json' } } }, { $id: b + 'b.json', properties: { r: { $ref: '#/definitions/nope' } } }],
    }, [{ q: { p: { r: 1 } } }, { q: { p: { r: 's' } } }, {}], false],
  ]
}

// What each entry point answers for one document, or null when it declined.
const ENTRY = {
  compileToJS: (s, m) => { const f = jc.compileToJS(s, null, m); return f && ((d) => f(d)) },
  compileToJSCodegen: (s, m) => { const f = jc.compileToJSCodegen(s, m); return f && ((d) => f(d)) },
  compileToJSCodegenWithErrors: (s, m) => { const f = jc.compileToJSCodegenWithErrors(s, m); return f && ((d) => f(d, true).valid) },
  compileToJSCombined: (s, m) => { const f = jc.compileToJSCombined(s, VALID_RESULT, m); return f && ((d) => f(d).valid) },
}
// Compiled on c05bd07 for the cases whose reference resolves; must stay so.
const MUST_COMPILE = ['compileToJSCodegen', 'compileToJSCodegenWithErrors', 'compileToJSCombined', 'toStandaloneModule']

const loadCjs = (src) => {
  const m = new Module('standalone')
  m.filename = path.join(ROOT, 'standalone-test.cjs')
  m.paths = Module._nodeModulePaths(ROOT)
  m._compile(src, m.filename)
  return m.exports
}

function check(name, c, docs, resolves, fresh) {
  const interp = new Validator(c.root, { schemas: c.schemas, engine: 'interpreter' })
  const expected = docs.map((d) => interp.validate(d).valid)
  // The case is only meaningful if the interpreted engine rejects something.
  if (!expected.includes(false)) fail(`${name}: the interpreted engine accepts every document, the case tests nothing`)

  const compiled = new Set()
  const agree = (where, verdict) => {
    docs.forEach((d, i) => {
      checks++
      let got
      try { got = verdict(d) } catch (e) { return } // throwing is loud, not silent
      if (got !== expected[i]) fail(`${name}: ${where} says ${got} for ${JSON.stringify(d)}, the interpreted engine ${expected[i]}`)
    })
  }

  // The entry points on the schema as written, with the registry as a Map.
  const map = new Map(c.schemas.map((s) => [s.$id, s]))
  for (const [ep, build] of Object.entries(ENTRY)) {
    let fn = null
    try { fn = build(c.root, map) } catch { fn = null }
    if (fn) agree(`${ep} (raw)`, fn)
  }

  // The entry points on what Validator hands them.
  const probe = new Validator(c.root, { schemas: c.schemas })
  const ps = probe._schemaObj
  const pm = probe._schemaMap && probe._schemaMap.size ? probe._schemaMap : null
  for (const [ep, build] of Object.entries(ENTRY)) {
    let fn = null
    try { fn = build(ps, pm) } catch { fn = null }
    if (fn) { compiled.add(ep); agree(`${ep} (prepared)`, fn) }
  }

  // The standalone emitters.
  let mod = null
  try { mod = aot.toStandaloneModule(new Validator(c.root, { schemas: c.schemas }), { format: 'cjs' }) } catch { mod = null }
  if (mod) {
    compiled.add('toStandaloneModule')
    const m = loadCjs(mod)
    agree('toStandaloneModule validate', (d) => m.validate(d).valid)
    agree('toStandaloneModule isValid', (d) => m.isValid(d))
  }
  let sa = null
  try { sa = aot.toStandalone(new Validator(c.root, { schemas: c.schemas })) } catch { sa = null }
  if (sa) {
    const m = loadCjs(sa)
    agree('toStandalone boolFn', (d) => m.boolFn(d))
    if (m.errFn) agree('toStandalone errFn', (d) => m.errFn(d, true).valid)
  }

  if (resolves) {
    for (const ep of MUST_COMPILE) if (!compiled.has(ep)) fail(`${name}: ${ep} declines a reference that resolves, which it compiled before`)
  }

  // A Validator, every read, first call and after the tier switch. A fresh
  // validator per read and document makes each first call a first call.
  const READS = {
    validate: (v, d) => v.validate(d).valid,
    isValidObject: (v, d) => v.isValidObject(d),
    validateJSON: (v, d) => v.validateJSON(JSON.stringify(d)).valid,
    isValidJSON: (v, d) => v.isValidJSON(JSON.stringify(d)),
    'isValid(buffer)': (v, d) => v.isValid(Buffer.from(JSON.stringify(d))),
  }
  for (const [read, call] of Object.entries(READS)) {
    agree(`${read} cold`, (d) => { const f = fresh(); return call(new Validator(f.root, { schemas: f.schemas }), d) })
    const warm = new Validator(c.root, { schemas: c.schemas })
    for (let i = 0; i < 300; i++) for (const d of docs) call(warm, d)
    agree(`${read} warm`, (d) => call(warm, d))
  }
}

console.log('\nreferences inside registered documents\n')
cases().forEach(([name, c, docs, resolves], i) => check(name, c, docs, resolves, () => cases()[i][1]))

// The generators themselves, below the gates: a reference they cannot
// resolve throws DECLINE rather than emitting nothing.
{
  const { DECLINE } = jc._internal
  const doc = { $id: 'https://example.com/gen/a.json', type: 'object', properties: { p: { $ref: 'missing.json#/definitions/x' } } }
  const map = new Map([[doc.$id, doc]])
  const unresolved = [
    { $ref: 'missing.json#/definitions/x' },
    { $ref: 'https://example.com/gen/missing.json' },
    { $ref: '#/definitions/nope' },
    { $ref: '#nope' },
  ]
  for (const s of unresolved) {
    for (const [gen, run] of Object.entries({
      genCode: () => jc._internal.genCode(s, 'd', [], { varCounter: 0, helpers: [], helperCode: [], preamble: [], shared: [], closureVars: [], closureVals: [], rootDefs: null, refStack: new Set(), schemaMap: map, anchors: {}, rootSchema: s }),
      genCodeC: () => require(ROOT + '/lib/js-compiler-errors.js')._internal.genCodeC(s, 'd', '""', [], { varCounter: 0, helperCode: [], rootDefs: null, refStack: new Set(), schemaMap: map, anchors: {}, rootSchema: s, inCombined: true, shared: [] }, '#'),
    })) {
      checks++
      let threw = null
      try { run() } catch (e) { threw = e }
      if (threw !== DECLINE) fail(`${gen} on ${JSON.stringify(s)}: ${threw ? 'threw ' + (threw && threw.message) : 'emitted code for an unresolved reference'} instead of declining`)
    }
  }
}

console.log(`  ${checks} checks`)
if (failures) {
  console.log(`\n${failures} failures`)
  process.exit(1)
}
console.log('\nok: every path declines or agrees with the interpreted engine\n')
