'use strict'

// A $ref (or $dynamicRef) that resolves to nothing, once evaluation reaches
// it, makes the whole validation invalid, with an error that names the
// reference. It used to fail only the subschema that held it, which under
// `not`, as an `if`, or in a `oneOf` branch is an acceptance:
// `{not: {$ref: 'missing.json'}}` accepted every value. A document that never
// reaches the reference keeps the answer it had.
//
// Every path is held to that here: the interpreted engine cold and warm, the
// closure tree, the small twin, compat, the JSON text readers short and long,
// the stream, the buffer readers, and every path that cannot express it
// (generated code, the modules, ata-validator/ir, the scanner), which must
// decline rather than answer. The mutants at the end show the cases would
// catch the old behaviour coming back.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const LIB = path.join(ROOT, 'lib')
const { Validator } = require(ROOT)
const Compat = (() => { const c = require(path.join(ROOT, 'compat.js')); return c.default || c })()
const aot = require(path.join(LIB, 'aot-impl'))
const build = require(path.join(ROOT, 'build'))
const { compileToJS, compileToJSCodegen, compileToJSCombined, compileToJSCodegenWithErrors } = require(path.join(LIB, 'js-compiler'))
const { compileScanner } = require(path.join(LIB, 'scan-compiler'))
const { bufferNeedsSlowPath } = require(path.join(LIB, 'buffer-gate'))
const core = require(path.join(LIB, 'interpreter'))

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

const D2020 = 'https://json-schema.org/draft/2020-12/schema'
const D7 = 'http://json-schema.org/draft-07/schema#'
const REFS = ['missing.json', '#/$defs/nope']

// Each context with a document that reaches the reference R.
const CONTEXTS = [
  ['not', (R) => ({ not: R }), 1],
  ['if', (R) => ({ if: R, then: { type: 'string' } }), 1],
  ['if alone', (R) => ({ if: R }), 1],
  ['then', (R) => ({ if: { type: 'number' }, then: R }), 1],
  ['else', (R) => ({ if: { type: 'string' }, else: R }), 1],
  ['oneOf', (R) => ({ oneOf: [{ type: 'string' }, R] }), 'x'],
  ['oneOf after two passing branches', (R) => ({ oneOf: [{}, {}, R] }), 1],
  ['oneOf after two passing branches, under not', (R) => ({ not: { oneOf: [{}, {}, R] } }), 1],
  ['anyOf after a passing branch', (R) => ({ anyOf: [{ type: 'string' }, R] }), 'x'],
  ['anyOf under not', (R) => ({ not: { anyOf: [{ type: 'string' }, R] } }), 'x'],
  ['allOf', (R) => ({ allOf: [{ type: 'string' }, R] }), 'x'],
  ['allOf after a failing branch, under not', (R) => ({ not: { allOf: [{ type: 'number' }, R] } }), 'x'],
  ['contains', (R) => ({ contains: R }), [1]],
  ['contains under not', (R) => ({ not: { contains: R } }), [1]],
  ['dependentSchemas', (R) => ({ dependentSchemas: { a: R } }), { a: 1 }],
  ['dependentSchemas under not', (R) => ({ not: { dependentSchemas: { a: R } } }), { a: 1 }],
  ['propertyNames', (R) => ({ propertyNames: R }), { a: 1 }],
  ['propertyNames under not', (R) => ({ not: { propertyNames: R } }), { a: 1 }],
  ['unevaluatedProperties', (R) => ({ unevaluatedProperties: R }), { a: 1 }],
  ['unevaluatedProperties under not', (R) => ({ not: { unevaluatedProperties: R } }), { a: 1 }],
  ['unevaluatedItems', (R) => ({ unevaluatedItems: R }), [1]],
  ['unevaluatedItems under not', (R) => ({ not: { unevaluatedItems: R } }), [1]],
  ['properties', (R) => ({ properties: { a: R } }), { a: 1 }],
  ['properties under not', (R) => ({ not: { properties: { a: R } } }), { a: 1 }],
  ['patternProperties', (R) => ({ patternProperties: { '^a': R } }), { a: 1 }],
  ['additionalProperties under not', (R) => ({ not: { additionalProperties: R } }), { a: 1 }],
  ['items under not', (R) => ({ not: { items: R } }), [1]],
  ['prefixItems under not', (R) => ({ not: { prefixItems: [R] } }), [1]],
  ['behind a reference that resolves', (R) => ({ $ref: '#/$defs/a', $defs: { a: { not: R } } }), 1],
  ['two negations deep in a branch', (R) => ({ oneOf: [{ type: 'string' }, { not: { not: R } }] }), 'x'],
  ['draft-07 dependencies', (R) => ({ $schema: D7, dependencies: { a: R } }), { a: 1 }],
]

// [label, schema, document, ref, keyword]
const REACHED = []
for (const ref of REFS) {
  for (const [label, make, doc] of CONTEXTS) {
    const s = make({ $ref: ref })
    REACHED.push([`${label}, ${ref}`, s.$schema ? s : { $schema: D2020, ...s }, doc, ref, '$ref'])
  }
}
REACHED.push(['not, $dynamicRef to no anchor', { $schema: D2020, not: { $dynamicRef: '#nope' } }, 1, '#nope', '$dynamicRef'])
REACHED.push(['if, $dynamicRef to no anchor', { $schema: D2020, if: { $dynamicRef: '#nope' }, then: { type: 'string' } }, 1, '#nope', '$dynamicRef'])

// SchemaStore minecraft-texture-mcmeta (draft-07): the reference at oneOf/1
// names a document that is not registered. Its negative test matched the
// first branch and reached the reference in the second, and was accepted.
const MINECRAFT = {
  $schema: D7,
  $id: 'https://json.schemastore.org/minecraft-texture-mcmeta.json',
  oneOf: [
    {
      properties: {
        animation: {
          type: 'object',
          properties: {
            interpolate: { type: 'boolean', default: false },
            width: { type: 'integer' },
            height: { type: 'integer' },
            frametime: { type: 'integer', default: 1 },
            frames: { type: 'array', items: { oneOf: [{ type: 'integer' }, { type: 'object', properties: { index: { type: 'integer' }, time: { type: 'integer' } } }] } },
          },
        },
      },
      required: ['animation'],
    },
    {
      properties: { fusion: { $ref: 'partial-fusion-texture-metadata.json#/definitions/fusion-properties' } },
      required: ['fusion'],
    },
  ],
  type: 'object',
}
const ANIMATION = { frames: [0, 1, 2, { index: 10, time: 20 }], frametime: 8, height: 8, interpolate: true, width: 8 }
const MINECRAFT_REF = 'partial-fusion-texture-metadata.json#/definitions/fusion-properties'
REACHED.push(['SchemaStore minecraft-texture-mcmeta negative test', MINECRAFT, { animation: ANIMATION, fusion: { layout: 'compact', render_type: 'opaque', type: 'connecting' } }, MINECRAFT_REF, '$ref'])

// Documents that never reach the reference: the answer they had, and no
// error about the reference.
const NOT_REACHED = [
  ['properties, name absent', { $schema: D2020, properties: { a: { not: { $ref: 'missing.json' } } } }, { b: 1 }, true],
  ['then, condition false', { $schema: D2020, if: { type: 'string' }, then: { $ref: 'missing.json' } }, 1, true],
  ['dependentSchemas, name absent', { $schema: D2020, dependentSchemas: { a: { $ref: 'missing.json' } } }, { b: 1 }, true],
  ['properties of a non-object', { $schema: D2020, type: 'object', properties: { a: { $ref: 'missing.json' } } }, 1, false],
  ['contains on an empty array', { $schema: D2020, contains: { $ref: 'missing.json' } }, [], false],
  ['a definition nothing references', { $schema: D2020, type: 'integer', $defs: { x: { $ref: 'missing.json' } } }, 1, true],
  ['SchemaStore minecraft-texture-mcmeta, animation only', MINECRAFT, { animation: ANIMATION }, true],
]

const pad = (text) => text + ' '.repeat(9000)
const ndjsonOf = (d) => JSON.stringify(d) + '\n' + JSON.stringify(d) + '\n'
const names = (r) => r.errors.map((e) => e.keyword).join(',')

function assertRefError(r, ref, keyword, where) {
  assert.strictEqual(r.valid, false, where)
  assert.strictEqual(r.errors.length, 1, `${where}: one error, got ${names(r)}`)
  const e = r.errors[0]
  assert.strictEqual(e.keyword, keyword, where)
  assert.strictEqual(e.params.ref, ref, where)
  assert.ok(e.message.includes(ref), `${where}: message names the reference: ${e.message}`)
}

console.log('unresolved references fail closed\n')

check(`${REACHED.length} reached cases: validate and isValidObject, on every engine`, () => {
  for (const [label, s, d, ref, kw] of REACHED) {
    const v = new Validator(s)
    assert.strictEqual(v.isValidObject(d), false, `${label}: isValidObject`)
    assertRefError(v.validate(d), ref, kw, `${label}: validate`)
    // The interpreted engine, cold (the plain walk) and past its tier, where
    // the closure tree would answer; it is not built for such a schema.
    const cold = new Validator(s, { engine: 'interpreter' })
    assert.strictEqual(cold.isValidObject(d), false, `${label}: interpreter isValidObject`)
    const first = cold.validate(d)
    assertRefError(first, ref, kw, `${label}: interpreter validate`)
    assert.deepStrictEqual(v.validate(d).errors[0].instancePath, first.errors[0].instancePath, `${label}: same place`)
    assert.deepStrictEqual(v.validate(d).errors[0].schemaPath, first.errors[0].schemaPath, `${label}: same place`)
    for (let i = 0; i < 1100; i++) cold.isValidObject(d)
    assert.strictEqual(cold.isValidObject(d), false, `${label}: warm isValidObject`)
    assert.deepStrictEqual(cold.validate(d).errors, first.errors, `${label}: warm validate`)
    // The engine directly, with the closure tree asked for at once.
    const it = core.createInterpreter(v._schemaObj, { tier: 0, v1: false })
    assert.strictEqual(it.isValid(d), false, `${label}: tier 0 isValid`)
    assert.strictEqual(it.validate(d).valid, false, `${label}: tier 0 validate`)
    assert.strictEqual(it._fast, null, `${label}: no closure tree`)
  }
})

check('reached cases: the JSON text readers, short and past 8 KB, and the scanner', () => {
  for (const [label, s, d, ref, kw] of REACHED) {
    const v = new Validator(s)
    const text = JSON.stringify(d)
    for (const t of [text, pad(text)]) {
      assert.strictEqual(v.isValidJSON(t), false, `${label}: isValidJSON (${t.length})`)
      assertRefError(v.validateJSON(t), ref, kw, `${label}: validateJSON (${t.length})`)
    }
    // Past the calls after which the scanner is built.
    for (let i = 0; i < 70; i++) v.isValidJSON(text)
    assert.strictEqual(v.isValidJSON(text), false, `${label}: isValidJSON warm`)
    assert.strictEqual(new Validator(s, { abortEarly: true }).validateJSON(text).valid, false, `${label}: validateJSON abortEarly`)
    assert.strictEqual(compileScanner(v._schemaObj), null, `${label}: the scanner declines`)
  }
})

check('reached cases: compat, the stream and the buffer readers', () => {
  for (const [label, s, d, ref] of REACHED) {
    for (const allErrors of [true, false]) {
      const f = new Compat({ strict: false, allErrors }).compile(structuredClone(s))
      assert.strictEqual(f(structuredClone(d)), false, `${label}: compat allErrors ${allErrors}`)
      assert.ok(f.errors.some((e) => e.params && e.params.ref === ref), `${label}: compat names the reference`)
    }
    const v = new Validator(s)
    for (const format of ['ndjson', 'array']) {
      const st = v.stream({ format })
      st.push(format === 'ndjson' ? ndjsonOf(d) : JSON.stringify([d, d]))
      assert.strictEqual(st.end().valid, false, `${label}: stream ${format}`)
    }
    assert.strictEqual(bufferNeedsSlowPath(v._schemaObj, new Map()), true, `${label}: buffer gate routes it`)
    const text = JSON.stringify(d)
    assert.strictEqual(v.isValid(Buffer.from(text)), false, `${label}: isValid`)
    assert.strictEqual(v.isValid(Buffer.from(pad(text))), false, `${label}: isValid past 8 KB`)
    assert.strictEqual(v.countValid(Buffer.from(ndjsonOf(d))), 0, `${label}: countValid`)
    assert.deepStrictEqual(v.isValidNDJSON(Buffer.from(ndjsonOf(d))), [false, false], `${label}: isValidNDJSON`)
    assert.deepStrictEqual(v.isValidParallel(Buffer.from(ndjsonOf(d))), [false, false], `${label}: isValidParallel`)
    assert.strictEqual(v.batchIsValid([Buffer.from(text)]), 0, `${label}: batchIsValid`)
    const padded = Buffer.alloc(text.length + 64)
    padded.write(text)
    assert.strictEqual(v.isValidPrepadded(padded, text.length), false, `${label}: isValidPrepadded`)
    assert.strictEqual(v.validateAndParse(text).valid, false, `${label}: validateAndParse`)
  }
})

check('a schema whose references all resolve stays on the native walker', () => {
  assert.strictEqual(bufferNeedsSlowPath({ not: { $ref: '#/$defs/a' }, $defs: { a: { type: 'string' } } }, new Map()), false)
})

check('reached cases: every generator, module form and ir backend declines', () => {
  for (const [label, s] of REACHED) {
    const v = new Validator(s)
    const n = v._schemaObj
    assert.strictEqual(compileToJSCodegen(n, null), null, `${label}: compileToJSCodegen`)
    assert.strictEqual(compileToJSCombined(n, Object.freeze({ valid: true, errors: [] }), null), null, `${label}: compileToJSCombined`)
    assert.strictEqual(compileToJSCodegenWithErrors(n, null), null, `${label}: compileToJSCodegenWithErrors`)
    assert.strictEqual(compileToJS(n, null, null), null, `${label}: compileToJS`)
    assert.strictEqual(aot.toStandalone(new Validator(s)), null, `${label}: toStandalone`)
    assert.strictEqual(aot.toStandaloneModule(new Validator(s), { format: 'cjs', onWarning () {} }), null, `${label}: toStandaloneModule`)
    assert.strictEqual(aot.toStandaloneModule(new Validator(s), { format: 'cjs', onePass: true, onWarning () {} }), null, `${label}: one pass`)
    assert.strictEqual(aot.toCompactModule(new Validator(s), { format: 'cjs', errorRuntime: './e.cjs' }), null, `${label}: toCompactModule`)
    assert.strictEqual(aot.toSchemaModule(new Validator(s), { format: 'cjs', runtime: './e.cjs' }), null, `${label}: toSchemaModule`)
    assert.ok(!build.compiledEligible(s) || build.compiledModuleFor(s, { format: 'cjs', plainErrors: true }) === null, `${label}: compiled module`)
    for (const f of ['bundleStandalone', 'bundleCompact']) {
      assert.ok(/module\.exports=\[null\];/.test(Validator[f]([s], { format: 'cjs' })), `${label}: ${f} leaves the slot empty`)
    }
    // A bundle's empty slot is answered at load by a Validator, which fails closed.
    const [loaded] = Validator.loadBundle([null], [s])
    assert.strictEqual(loaded.isValidObject(REACHED.find((x) => x[1] === s)[2]), false, `${label}: loadBundle`)
  }
})


check(`${NOT_REACHED.length} documents that never reach the reference keep their answer`, () => {
  for (const [label, s, d, valid] of NOT_REACHED) {
    for (const opts of [{}, { engine: 'interpreter' }]) {
      const v = new Validator(s, opts)
      const r = v.validate(d)
      assert.strictEqual(r.valid, valid, `${label}: validate`)
      assert.strictEqual(v.isValidObject(d), valid, `${label}: isValidObject`)
      assert.strictEqual(v.isValidJSON(JSON.stringify(d)), valid, `${label}: isValidJSON`)
      assert.ok(r.errors.every((e) => e.keyword !== '$ref'), `${label}: no reference error, got ${names(r)}`)
    }
  }
})

check('the small twin answers them the same way', () => {
  // The twin answers a small schema's first calls once a process has met 16
  // schemas; tests/run.js turns it off, so it runs in a process of its own.
  const env = { ...process.env }
  delete env.ATA_NO_SMALL_TWIN
  const local = REACHED.filter((x) => x[3] === '#/$defs/nope' && !x[1].$schema.includes('draft-07'))
  const code = `
    const { Validator } = require(${JSON.stringify(ROOT)})
    for (let i = 0; i < 20; i++) new Validator({ type: 'integer', minimum: i }).isValidObject(1)
    const out = []
    for (const [s, d] of ${JSON.stringify(local.map((x) => [x[1], x[2]]))}) {
      const v = new Validator(s)
      const verdict = v.isValidObject(d)
      const twin = v._twin != null && v._twin.constructor.name === 'SmallTwin'
      const r = v.validate(d)
      out.push([verdict, twin, r.valid, r.errors.length === 1 && r.errors[0].keyword])
    }
    process.stdout.write(JSON.stringify(out))`
  const r = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, env, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.strictEqual(out.length, local.length)
  let twin = 0
  out.forEach(([verdict, onTwin, valid, kw], i) => {
    assert.strictEqual(verdict, false, `${local[i][0]}: twin isValidObject`)
    assert.strictEqual(valid, false, `${local[i][0]}: twin validate`)
    assert.strictEqual(kw, '$ref', `${local[i][0]}: twin error`)
    if (onTwin) twin++
  })
  assert.ok(twin > 0, 'the twin answered some of them')
})

// Mutants: each puts back what a path did before, and the cases above must
// tell it apart. A module compiled from altered source, as a file of lib/ so
// its own requires resolve.
function loadMutant (file, from, to) {
  const src = fs.readFileSync(path.join(LIB, file), 'utf8')
  assert.ok(src.includes(from), `${file}: the mutated text is there`)
  const m = new Module(path.join(LIB, 'mutant-' + file))
  m.filename = path.join(LIB, 'mutant-' + file)
  m.paths = Module._nodeModulePaths(LIB)
  m._compile(src.split(from).join(to), m.filename)
  return m.exports
}
const byLabel = (prefix) => REACHED.filter((x) => x[4] === '$ref' && x[0].startsWith(prefix + ','))

check('mutant: the interpreted engine failing only the subschema at the reference', () => {
  const mutant = loadMutant('interpreter-core.js',
    "throw new RefAbort(err('$ref', '$ref', instancePath, schemaPath + '/$ref', { ref: P.ref }, `cannot resolve $ref ${P.ref}`));",
    "{ if (errors !== NOERRORS) errors.push(err('$ref', '$ref', instancePath, schemaPath + '/$ref', { ref: P.ref }, `cannot resolve $ref ${P.ref}`)); valid = false; }")
  for (const [label, s, d] of [...byLabel('not'), ...byLabel('if')]) {
    const n = new Validator(s)._schemaObj
    assert.strictEqual(core.createInterpreter(n).isValid(d), false, `${label}: the engine refuses`)
    assert.strictEqual(mutant.createInterpreter(n).isValid(d), true, `${label}: the mutant accepts, so this case catches it`)
    assert.strictEqual(mutant.createInterpreter(n).validate(d).valid, true, `${label}: the mutant accepts`)
  }
})

check('mutant: the closure tree failing only the subschema at the reference', () => {
  const mutant = loadMutant('plan-compiler.js', 'ctx.unresolved = true;\n        continue;', 'steps.push(() => false);\n        vsteps.push(() => false);\n        continue;')
  try {
    core._setPlanCompiler(() => mutant.install)
    for (const [label, s, d] of [...byLabel('not'), ...byLabel('if')]) {
      const n = new Validator(s)._schemaObj
      assert.strictEqual(core.createInterpreter(n, { tier: 0 }).isValid(d), true, `${label}: the mutant tree accepts, so this case catches it`)
    }
  } finally {
    core._setPlanCompiler(() => require(path.join(LIB, 'plan-compiler')).install)
  }
  for (const [label, s, d] of [...byLabel('not'), ...byLabel('if')]) {
    assert.strictEqual(core.createInterpreter(new Validator(s)._schemaObj, { tier: 0 }).isValid(d), false, `${label}: the engine refuses`)
  }
})

check('mutant: validate() skipping the anyOf branches after one that passes', () => {
  const mutant = loadMutant('interpreter-core.js', '  _hasDangling() {\n', '  _hasDangling() {\n    return false;\n')
  for (const prefix of ['anyOf after a passing branch']) {
    for (const [label, s, d] of byLabel(prefix)) {
      const it = mutant.createInterpreter(new Validator(s)._schemaObj)
      assert.strictEqual(it.isValid(d), false, `${label}: the verdict walk reaches it`)
      assert.strictEqual(it.validate(d).valid, true, `${label}: the mutant's validate() does not, so this case catches it`)
    }
  }
})

;(async () => {
  // ata-validator/ir is ESM: each of its backends must refuse the schema.
  const ir = await import(require('url').pathToFileURL(path.join(LIB, 'ir/index.mjs')).href)
  const refused = (fn) => { try { return fn() === null } catch (e) { return typeof e.message === 'string' && e.message.startsWith('ir:') } }
  for (const [label, s] of REACHED) {
    assert.ok(refused(() => ir.specialize(s, { verdict: true })), `${label}: ir specialize`)
    assert.ok(refused(() => ir.specialize(s, { verdict: true, richErrors: false })), `${label}: ir specialize, plain errors`)
    assert.ok(refused(() => ir.compileClosures(s, {})), `${label}: ir closures`)
    assert.ok(refused(() => ir.tableModule(s, {})), `${label}: ir table`)
    assert.ok(refused(() => ir.tablePlan(s, {})), `${label}: ir plan`)
    assert.ok(refused(() => ir.closureModule(s, { richErrors: false })), `${label}: ir closure module`)
  }
  console.log('  PASS  reached cases: every ir backend refuses')
  passed++

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-unres-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.schema.json'), JSON.stringify({ $schema: D2020, not: { $ref: 'missing.json' } }))
    const report = await build.build({ globs: [path.join(dir, '*.schema.json')] })
    assert.strictEqual(report.compiled.length, 0)
    assert.strictEqual(report.skipped.length, 1)
    assert.ok(/does not resolve/.test(report.skipped[0].reason), report.skipped[0].reason)
    assert.deepStrictEqual(fs.readdirSync(dir), ['a.schema.json'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  console.log('  PASS  ata build skips such a schema rather than writing a module for it')
  passed++

  console.log(`\n${passed} passed`)
})().catch((e) => { console.error(e); process.exit(1) })
