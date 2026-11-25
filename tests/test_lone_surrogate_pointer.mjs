// A reference whose fragment holds a lone surrogate, a tab, or another
// character the URL parser rewrites. The resolvers ran `new URL(ref, base)`
// and read the fragment back from the result, and the parser turns a lone
// surrogate into %EF%BF%BD (U+FFFD) and drops a tab, so the pointer named a
// property the schema does not have: "cannot resolve $ref", every value
// rejected, and under the 2.0 entries a local reference too. The fragment is
// now read from the reference as written, which base resolution never
// changes; the document part still comes from the URL.
//
// Every engine is held to it: the 1.x Validator (generated code, the
// interpreted engine, defaults, a process that blocks code generation), the
// 2.0 edge, browser and plugin core entries, the verdict core, the small
// engine, ata-validator/ir (module, closures, table), the standalone module
// and the build's registry pruning, and the error order behind a reference
// into another document. A pointer that names nothing is still refused or
// failed exactly as before, and the refusal walk (inverted()) agrees with the
// resolver. The mutant at the end puts the old fragment back.

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIB = path.join(ROOT, 'lib')
const { Validator } = require(path.join(ROOT, 'index.js'))
const build = require(path.join(ROOT, 'build.js'))
const F = await import(pathToFileURL(path.join(ROOT, 'index.v2.features.mjs')).href)
const { Validator: Edge } = await import(pathToFileURL(path.join(ROOT, 'index.v2.edge.mjs')).href)
const { Validator: Browser } = await import(pathToFileURL(path.join(ROOT, 'index.v2.browser.mjs')).href)
const ir = await import(pathToFileURL(path.join(LIB, 'ir/index.mjs')).href)
const { orderOf, front } = await import(pathToFileURL(path.join(LIB, 'ir/front.mjs')).href)
const { fromPlan } = await import(pathToFileURL(path.join(LIB, 'kernels/plan.mjs')).href)
const { createVerdict } = require(path.join(LIB, 'core/verdict.js'))
const full = require(path.join(LIB, 'engine-full.js'))
const { createEngine } = require(path.join(LIB, 'core/engine.js'))
const { indexSchemas, resolveRef } = require(path.join(LIB, 'engine-shared.js'))

let passed = 0
async function check (name, fn) { await fn(); console.log(`  PASS  ${name}`); passed++ }

// A high surrogate, a low one, a high one ending the name, a tab; and a
// name the parser leaves alone, which resolved before.
const NAMES = [['high', 'a\uD800b'], ['low', 'a\uDC00b'], ['at the end', 'ab\uD83D'], ['tab', 'a\tb'], ['astral', 'a\u{1F600}b']]
const cond = { properties: { v: { const: 'x' } }, required: ['v'] }
const YES = { v: 'x' }
const NO = { v: 'y' }

// [label, schema, options, valid document, invalid document]
const CASES = []
for (const [what, n] of NAMES) {
  CASES.push([`local, ${what}`, { $defs: { r: { properties: { [n]: { if: cond } } } }, $ref: '#/$defs/r/properties/' + n + '/if' }, {}, YES, NO])
  CASES.push([`another document, ${what}`, { $ref: 'https://e.com/root#/properties/' + n + '/if' }, { schemas: [{ $id: 'https://e.com/root', properties: { [n]: { if: cond } } }] }, YES, NO])
  CASES.push([`$dynamicRef to a pointer, ${what}`, { $defs: { [n]: { type: 'string' } }, $dynamicRef: '#/$defs/' + n }, {}, 'x', 1])
  CASES.push([`under not, ${what}`, { not: { $ref: '#/$defs/' + n }, $defs: { [n]: { type: 'string' } } }, {}, 1, 'x'])
  CASES.push([`under not in another document, ${what}`, { not: { $ref: 'urn:o#/$defs/' + n } }, { schemas: [{ $id: 'urn:o', $defs: { [n]: { type: 'string' } } }] }, 1, 'x'])
}
// Anchors the schema declares with a lone surrogate, which no metaschema
// check stops: a $ref and a $dynamicRef to them, here and in another
// document, and a $dynamicRef the dynamic scope redirects (the outermost
// resource declaring the anchor wins, so 1 fails there).
CASES.push(['$ref to an anchor', { $defs: { x: { $anchor: 'a\uD800', type: 'string' } }, $ref: '#a\uD800' }, {}, 'x', 1])
CASES.push(['$dynamicRef to a dynamic anchor', { $defs: { x: { $dynamicAnchor: 'a\uD800', type: 'string' } }, $dynamicRef: '#a\uD800' }, {}, 'x', 1])
CASES.push(['$ref to an anchor in another document', { $ref: 'urn:o#a\uD800' }, { schemas: [{ $id: 'urn:o', $defs: { x: { $anchor: 'a\uD800', type: 'string' } } }] }, 'x', 1])
CASES.push(['$dynamicRef on the dynamic scope', { $id: 'urn:root', $ref: 'urn:list', $defs: { o: { $dynamicAnchor: 'n\uDC00', type: 'string' } } }, { schemas: [{ $id: 'urn:list', $defs: { d: { $dynamicAnchor: 'n\uDC00' } }, $dynamicRef: '#n\uDC00' }] }, 'x', 1])
CASES.push(['$dynamicRef on the dynamic scope, one document', { $id: 'https://e.com/root', $ref: 'list', $defs: { o: { $dynamicAnchor: 'n\uDC00', type: 'string' }, l: { $id: 'list', $defs: { d: { $dynamicAnchor: 'n\uDC00' } }, $dynamicRef: '#n\uDC00' } } }, {}, 'x', 1])

const FRESH = ['validator-small.js', 'groups.js', 'engine-small.js'].map((f) => path.join(LIB, f))
const cores = new Map()
function coreWith (names) {
  const key = [...names].sort().join(',')
  let V = cores.get(key)
  if (V === undefined) {
    for (const f of FRESH) delete require.cache[f]
    V = require(FRESH[0]).Validator
    if (names.length) V.use(...names.map((x) => F[x]))
    for (const f of FRESH) delete require.cache[f]
    cores.set(key, V)
  }
  return V
}
const interp = class extends Validator { constructor (s, o) { super(s, { ...o, engine: 'interpreter' }) } }
// Past its first 1000 calls the interpreted engine answers from the closure
// tree (lib/plan-compiler.js), which resolves the references again.
const hot = (V) => class extends V { constructor (s, o) { super(s, o); for (let i = 0; i < 1001; i++) { this.validate(1); this.isValidObject({}) } } }
const defaults = class extends Validator { constructor (s, o) { super(s, { ...o, useDefaults: true }) } }
const ENTRIES = [
  ['1.x', () => Validator],
  ['1.x interpreter', () => interp],
  ['1.x after 1001 calls', () => hot(Validator)],
  ['1.x interpreter after 1001 calls', () => hot(interp)],
  ['1.x useDefaults', () => defaults],
  ['edge', () => Edge],
  ['browser', () => Browser],
  ['plugin core, featuresFor()', (s, o) => coreWith(F.featuresFor(s, o))],
]

console.log('a reference whose fragment the URL parser would rewrite resolves on every path\n')

await check(`${CASES.length} schemas: every entry, every call`, () => {
  for (const [label, s, o, yes, no] of CASES) {
    for (const [name, of] of ENTRIES) {
      const V = of(s, o)
      for (const [d, want] of [[yes, true], [no, false]]) {
        const at = `${label}: ${name} on ${JSON.stringify(d)}`
        const v = new V(s, o)
        const r = v.validate(structuredClone(d))
        assert.strictEqual(r.valid, want, `${at} validate, got ${r.valid ? 'valid' : r.errors.map((e) => e.message).join('; ')}`)
        assert.strictEqual(v.isValidObject(structuredClone(d)), want, `${at} isValidObject`)
        const w = new V(s, o)
        assert.strictEqual(w.isValidJSON(JSON.stringify(d)), want, `${at} isValidJSON`)
        assert.strictEqual(w.validateJSON(JSON.stringify(d)).valid, want, `${at} validateJSON`)
      }
    }
  }
})

await check('the generated code takes the dynamic scope it unrolls, where it took the plain name', () => {
  for (const [label, s, o] of CASES.filter((c) => c[0].startsWith('$dynamicRef on the dynamic scope'))) {
    const v = new Validator(s, o)
    v.validate(1)
    assert.strictEqual(v._engine, 'codegen', `${label}: the generated code`)
  }
})

await check('the verdict core, the small engine and the one engine (lib/core/engine.js)', () => {
  for (const [label, s, o, yes, no] of CASES) {
    const schemaMap = o.schemas ? new Map(o.schemas.map((x) => [x.$id, x])) : null
    const core = createVerdict(s, { schemaMap })
    assert.strictEqual(core(structuredClone(yes)), true, `${label}: the core`)
    assert.strictEqual(core(structuredClone(no)), false, `${label}: the core`)
    const small = full.createSmall(s, { schemaMap })
    assert.strictEqual(small.isValid(structuredClone(yes)), true, `${label}: the small engine`)
    assert.strictEqual(small.isValid(structuredClone(no)), false, `${label}: the small engine`)
    const one = createEngine(s, { schemaMap })
    for (const [d, want] of [[yes, true], [no, false]]) {
      assert.strictEqual(one.isValid(structuredClone(d)), want, `${label}: the one engine isValid`)
      assert.strictEqual(one.validate(structuredClone(d)).valid, want, `${label}: the one engine validate`)
    }
  }
})

const KERNELS = pathToFileURL(path.join(LIB, 'kernels/index.mjs')).href
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-surrogate-')))
let seq = 0
const load = async (src) => { const f = path.join(tmp, `m${seq++}.mjs`); fs.writeFileSync(f, src.replace(/(['"])ata-validator\/kernels\1/g, () => JSON.stringify(KERNELS))); return import(pathToFileURL(f).href) }

try {
  await check('ata-validator/ir: module, closures and, for a local reference, the table plan', async () => {
    let tables = 0
    for (const [label, s, o, yes, no] of CASES) {
      const m = await load(ir.specialize(s, { schemas: o.schemas }))
      const c = ir.compileClosures(s, { schemas: o.schemas })
      for (const [d, want] of [[yes, true], [no, false]]) {
        assert.strictEqual(m.isValid(structuredClone(d)), want, `${label}: module isValid`)
        assert.strictEqual(m.validate(structuredClone(d)).valid, want, `${label}: module validate`)
        assert.strictEqual(c.isValid(structuredClone(d)), want, `${label}: closures isValid`)
        assert.strictEqual(c.validate(structuredClone(d)).valid, want, `${label}: closures validate`)
      }
      if (o.schemas) continue
      const p = ir.tablePlan(s, { richErrors: false })
      if (p === null) continue
      const t = await fromPlan(p)
      assert.strictEqual(t.validate(structuredClone(yes)).valid, true, `${label}: table`)
      assert.strictEqual(t.validate(structuredClone(no)).valid, false, `${label}: table`)
      tables++
    }
    assert.ok(tables >= 5, `${tables} table plans`)
  })

  await check('the standalone module', async () => {
    let built = 0
    for (const [label, s, o, yes, no] of CASES) {
      const src = build.toStandaloneModule(s, o)
      if (src === null) continue
      const m = await load(src)
      assert.strictEqual(m.validate(structuredClone(yes)).valid, true, `${label}: standalone`)
      assert.strictEqual(m.validate(structuredClone(no)).valid, false, `${label}: standalone`)
      built++
    }
    assert.ok(built >= 20, `${built} standalone modules`)
  })

  await check('the build keeps the definition such a reference names in the registry, and drops the unused one', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'b-'))
    const U = 'https://example.test/s/'
    const name = 'M\uD800'
    fs.writeFileSync(path.join(dir, '_defs.json'), JSON.stringify({ definitions: { [name]: { type: 'string', minLength: 2 }, Unused: { type: 'string', description: 'z'.repeat(200) } } }))
    fs.writeFileSync(path.join(dir, 'svc.json'), JSON.stringify({ type: 'object', properties: { a: { $ref: U + '_defs.json#/definitions/' + name } } }))
    const r = await build.build({ globs: [path.join(dir, '*.json')], outDir: path.join(dir, 'o'), types: false, mode: 'schema', baseUri: U })
    assert.ok(r.compiled.some((c) => c.output.endsWith('svc.compiled.mjs')), 'svc.json compiled')
    const reg = fs.readFileSync(path.join(dir, 'o', 'ata-registry.mjs'), 'utf8')
    assert.ok(!reg.includes('Unused'), 'the unused definition is dropped')
    const m = await import(pathToFileURL(path.join(dir, 'o', 'svc.compiled.mjs')).href)
    assert.strictEqual(m.isValid({ a: 'xy' }), true)
    assert.strictEqual(m.isValid({ a: 'x' }), false)
  })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

await check('with code generation blocked, the 1.x Validator', () => {
  const script = `const { Validator } = require(${JSON.stringify(path.join(ROOT, 'index.js'))}); const out = []
    for (const [s, o, y, n] of ${JSON.stringify(CASES.map((c) => c.slice(1)))}) { const v = new Validator(s, o); out.push([v.validate(y).valid, v.isValidObject(n)]) }
    console.log(JSON.stringify(out))`
  const r = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '-e', script], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.deepStrictEqual(JSON.parse(r.stdout), CASES.map(() => [true, false]))
})

await check('errors behind a reference into another document come in the order the target declares them', () => {
  const mk = (n) => [{ $ref: 'https://e.com/root#/properties/' + n }, { schemas: [{ $id: 'https://e.com/root', properties: { [n]: { anyOf: [{ required: ['q'] }], minProperties: 3, required: ['w'], properties: { v: { type: 'string' } } } } }] }]
  const kw = (r) => r.errors.map((e) => e.keyword).join(',')
  for (const [name, of] of ENTRIES) {
    const plain = mk('ab')
    const want = kw(new (of(...plain))(...plain).validate({ v: 1 }))
    assert.strictEqual(want, 'anyOf,minProperties,required,type', `${name}: the plain name`)
    for (const [what, n] of NAMES) {
      const c = mk(n)
      assert.strictEqual(kw(new (of(...c))(...c).validate({ v: 1 })), want, `${name}, ${what}`)
    }
  }
  // The order skeleton ata-validator/ir sorts by points at the name as written.
  const n = 'a\uD800b'
  const sk = orderOf(front({ $ref: 'https://e.com/root#/properties/' + n }, { schemas: [{ $id: 'https://e.com/root', properties: { [n]: { minProperties: 3 } } }] }))
  assert.strictEqual(sk.$ref, '#/$ata.docs/0/properties/' + n)
})

// A pointer that names nothing: refused by the 2.0 entries where failing it
// could be inverted, failed in place by 1.x, as before. The refusal walk and
// the resolver agree on every pointer.
const MISSING = ['a\uD800c', 'a\uDC00', 'b\uD800', 'a\tc', 'zz']
await check('a pointer that names nothing is refused or failed as before, and inverted() agrees with the resolver', () => {
  const defs = { $defs: { 'a\uD800b': { type: 'string' }, 'a\tb': { type: 'string' } } }
  for (const p of [...MISSING, 'a\uD800b', 'a\tb']) {
    const s = { not: { $ref: '#/$defs/' + p }, ...defs }
    const missing = resolveRef('#/$defs/' + p, 'ata://root', indexSchemas(s, null)).node === undefined
    assert.strictEqual(missing, MISSING.includes(p), `${JSON.stringify(p)}: the resolver`)
    let refused = false
    try { full.createSmall(s, { schemaMap: null }) } catch (e) { assert.match(e.message, /^ata2: cannot resolve \$ref /); refused = true }
    assert.strictEqual(refused, missing, `${JSON.stringify(p)}: inverted() refuses exactly where the resolver finds nothing`)
    if (!missing) continue
    const message = `ata2: cannot resolve $ref #/$defs/${p}`
    for (const V of [Edge, Browser]) assert.throws(() => new V(s).validate(1), { message })
    assert.throws(() => createVerdict(s, { schemaMap: null }), { message })
    assert.throws(() => ir.specialize(s, {}), { message: message.replace(/^ata2: /, 'ir: ') })
    for (const V of [Validator, interp]) { const v = new V(s); assert.strictEqual(v.validate(1).valid, false); assert.strictEqual(v.validate('x').valid, false) }
    // Where failing it can only reject, every entry fails it in place.
    const pos = { properties: { a: { $ref: '#/$defs/' + p } }, ...defs }
    for (const V of [Validator, interp, Edge, Browser]) assert.strictEqual(new V(pos).validate({ a: 'x' }).valid, false, `${JSON.stringify(p)}: properties`)
    const cross = [{ $ref: 'urn:o#/$defs/' + p }, { schemas: [{ $id: 'urn:o', ...defs }] }]
    for (const V of [Validator, interp, Edge, Browser]) assert.strictEqual(new V(...cross).validate('x').valid, false, `${JSON.stringify(p)}: another document`)
  }
})

// The mutant reads the fragment back from the resolved URL, as before.
await check('mutant: the fragment read from the URL the parser rewrote', () => {
  const file = path.join(LIB, 'engine-shared.js')
  const src = fs.readFileSync(file, 'utf8')
  const from = '[rawUri, fragment] = splitFragment(ref), uri = splitFragment(abs)[0]'
  assert.ok(src.includes(from), 'the mutated text is there')
  const name = path.join(LIB, 'mutant-engine-shared.js')
  const m = new Module(name)
  m.filename = name
  m.paths = Module._nodeModulePaths(LIB)
  m._compile(src.split(from).join('[rawUri] = splitFragment(ref), [uri, fragment] = splitFragment(abs)'), name)
  let caught = 0
  for (const [, n] of NAMES) {
    const s = { $defs: { [n]: {} } }
    const ok = m.exports.resolveRef('#/$defs/' + n, 'ata://root', m.exports.indexSchemas(s, null)).node !== undefined
    assert.strictEqual(resolveRef('#/$defs/' + n, 'ata://root', indexSchemas(s, null)).node !== undefined, true, `${JSON.stringify(n)} resolves`)
    if (!ok) caught++
  }
  assert.strictEqual(caught, NAMES.length - 1, `${caught} names the mutant loses, every one but the astral`)
})

console.log(`\n${passed} passed, 0 failed`)
