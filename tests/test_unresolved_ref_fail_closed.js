'use strict'

// A $ref (or $dynamicRef) that resolves to nothing has an unknown verdict.
// Failing it in place is sound wherever a failure can only reject: allOf,
// anyOf, properties and the other keywords that apply a subschema to a value.
// Under not, an if condition, a oneOf branch, a contains with maxContains, or
// a node with unevaluated*, a failure can be inverted, and
// `{not: {$ref: 'missing.json'}}` accepted every value. There, reaching the
// reference makes the whole validation invalid with an error that names it.
// Everywhere else the answer is the one 0eff4af gave, and an anyOf with a
// passing branch accepts whatever the unknown is.
//
// Each case says which: 'abort' (invalid, the one reference error), 'reject'
// (invalid, failed in place) or 'accept'. Every path is held to it: the
// interpreted engine cold and warm, the closure tree, the small twin, compat,
// the JSON text readers short and long, the stream, the buffer readers, and
// the paths that decline (generated code, the modules, the scanner, and
// ata-validator/ir for the abort cases). The mutants at the end show the
// cases would catch the old behaviour coming back.

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
const { hasNegativeRef } = require(path.join(LIB, 'negative-refs'))

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

const D2020 = 'https://json-schema.org/draft/2020-12/schema'
const D7 = 'http://json-schema.org/draft-07/schema#'
const REFS = ['missing.json', '#/$defs/nope']

// Each context with a document that reaches the reference R, and the answer.
const CONTEXTS = [
  ['not', (R) => ({ not: R }), 1, 'abort'],
  ['if', (R) => ({ if: R, then: { type: 'string' } }), 1, 'abort'],
  ['if alone', (R) => ({ if: R }), 1, 'abort'],
  ['then', (R) => ({ if: { type: 'number' }, then: R }), 1, 'reject'],
  ['else', (R) => ({ if: { type: 'string' }, else: R }), 1, 'reject'],
  ['oneOf', (R) => ({ oneOf: [{ type: 'string' }, R] }), 'x', 'abort'],
  ['oneOf after two passing branches', (R) => ({ oneOf: [{}, {}, R] }), 1, 'abort'],
  ['oneOf after two passing branches, under not', (R) => ({ not: { oneOf: [{}, {}, R] } }), 1, 'abort'],
  ['anyOf after a passing branch', (R) => ({ anyOf: [{ type: 'string' }, R] }), 'x', 'accept'],
  ['anyOf, the reference first', (R) => ({ anyOf: [R, { type: 'string' }] }), 'x', 'accept'],
  ['anyOf, no branch passes', (R) => ({ anyOf: [{ type: 'string' }, R] }), 1, 'reject'],
  ['anyOf whose later branch negates it, after one that passes', (R) => ({ anyOf: [{ type: 'string' }, { not: R }] }), 'x', 'accept'],
  ['anyOf under not, a branch passes first', (R) => ({ not: { anyOf: [{ type: 'string' }, R] } }), 'x', 'reject'],
  ['anyOf under not, the reference reached', (R) => ({ not: { anyOf: [{ type: 'string' }, R] } }), 1, 'abort'],
  ['allOf', (R) => ({ allOf: [{ type: 'string' }, R] }), 'x', 'reject'],
  ['allOf after a failing branch, under not', (R) => ({ not: { allOf: [{ type: 'number' }, R] } }), 'x', 'abort'],
  ['contains', (R) => ({ contains: R }), [1], 'reject'],
  ['contains with maxContains', (R) => ({ contains: R, maxContains: 1 }), [1], 'abort'],
  ['contains under not', (R) => ({ not: { contains: R } }), [1], 'abort'],
  ['dependentSchemas', (R) => ({ dependentSchemas: { a: R } }), { a: 1 }, 'reject'],
  ['dependentSchemas under not', (R) => ({ not: { dependentSchemas: { a: R } } }), { a: 1 }, 'abort'],
  ['propertyNames', (R) => ({ propertyNames: R }), { a: 1 }, 'reject'],
  ['propertyNames under not', (R) => ({ not: { propertyNames: R } }), { a: 1 }, 'abort'],
  ['unevaluatedProperties', (R) => ({ unevaluatedProperties: R }), { a: 1 }, 'abort'],
  ['beside unevaluatedProperties', (R) => ({ anyOf: [{ properties: { a: R } }, {}], unevaluatedProperties: false }), { a: 1 }, 'abort'],
  ['unevaluatedProperties under not', (R) => ({ not: { unevaluatedProperties: R } }), { a: 1 }, 'abort'],
  ['unevaluatedItems', (R) => ({ unevaluatedItems: R }), [1], 'abort'],
  ['unevaluatedItems under not', (R) => ({ not: { unevaluatedItems: R } }), [1], 'abort'],
  ['properties', (R) => ({ properties: { a: R } }), { a: 1 }, 'reject'],
  ['properties under not', (R) => ({ not: { properties: { a: R } } }), { a: 1 }, 'abort'],
  ['patternProperties', (R) => ({ patternProperties: { '^a': R } }), { a: 1 }, 'reject'],
  ['additionalProperties', (R) => ({ additionalProperties: R }), { a: 1 }, 'reject'],
  ['additionalProperties under not', (R) => ({ not: { additionalProperties: R } }), { a: 1 }, 'abort'],
  ['items', (R) => ({ items: R }), [1], 'reject'],
  ['items under not', (R) => ({ not: { items: R } }), [1], 'abort'],
  ['prefixItems under not', (R) => ({ not: { prefixItems: [R] } }), [1], 'abort'],
  ['behind a reference that resolves, positive', (R) => ({ $ref: '#/$defs/a', $defs: { a: { properties: { p: R } } } }), { p: 1 }, 'reject'],
  ['behind a reference that resolves, under not', (R) => ({ $ref: '#/$defs/a', $defs: { a: { not: R } } }), 1, 'abort'],
  ['two negations deep in a branch', (R) => ({ oneOf: [{ type: 'string' }, { not: { not: R } }] }), 'x', 'abort'],
  ['two negations, no branch', (R) => ({ not: { not: R } }), 1, 'abort'],
  ['draft-07 dependencies', (R) => ({ $schema: D7, dependencies: { a: R } }), { a: 1 }, 'reject'],
  // After a sibling that already failed, under `not`: the walk does not stop
  // at the failure there.
  ['properties after a failing property, under not', (R) => ({ not: { properties: { a: { type: 'string' }, b: R } } }), { a: 1, b: 1 }, 'abort'],
  ['properties after a failing required, under not', (R) => ({ not: { required: ['zz'], properties: { a: R } } }), { a: 1 }, 'abort'],
  ['prefixItems after a failing item, under not', (R) => ({ not: { prefixItems: [{ type: 'string' }, R] } }), [1, 2], 'abort'],
  ['items after a failing type, under not', (R) => ({ not: { type: 'string', items: R } }), [1], 'abort'],
  ['additionalProperties after a failing property, under not', (R) => ({ not: { properties: { a: { type: 'string' } }, additionalProperties: R } }), { a: 1, b: 1 }, 'abort'],
  ['patternProperties after a failing property, under not', (R) => ({ not: { properties: { a: { type: 'string' } }, patternProperties: { '^b': R } } }), { a: 1, b: 1 }, 'abort'],
  ['dependentSchemas after a failing one, under not', (R) => ({ not: { dependentSchemas: { a: { required: ['zz'] }, b: R } } }), { a: 1, b: 1 }, 'abort'],
  ['propertyNames in a branch, under not', (R) => ({ not: { propertyNames: { anyOf: [{ maxLength: 0 }, R] } } }), { ab: 1 }, 'abort'],
  ['contains after a matching item, under not', (R) => ({ not: { contains: { anyOf: [{ type: 'string' }, R] } } }), ['x', 1], 'abort'],
  ['then after a failing minimum, under not', (R) => ({ not: { if: { type: 'number' }, then: { allOf: [{ minimum: 5 }, R] } } }), 1, 'abort'],
  ['if in an anyOf branch after one that passes', (R) => ({ anyOf: [{ type: 'string' }, { if: R }] }), 'x', 'accept'],
  ['two items reaching it, under not', (R) => ({ not: { items: { anyOf: [{ type: 'string' }, R] } } }), [1, 2], 'abort'],
  ['two properties reaching it, under not', (R) => ({ not: { properties: { a: R, b: R } } }), { b: 1, a: 1 }, 'abort'],
  ['oneOf in a not, after a passing branch', (R) => ({ not: { oneOf: [{ type: 'string' }, { allOf: [{ type: 'number' }, R] }] } }), 'x', 'abort'],
]

// [label, schema, document, ref, keyword, answer]
const REACHED = []
for (const ref of REFS) {
  for (const [label, make, doc, answer] of CONTEXTS) {
    const s = make({ $ref: ref })
    REACHED.push([`${label}, ${ref}`, s.$schema ? s : { $schema: D2020, ...s }, doc, ref, '$ref', answer])
  }
}
REACHED.push(['not, $dynamicRef to no anchor', { $schema: D2020, not: { $dynamicRef: '#nope' } }, 1, '#nope', '$dynamicRef', 'abort'])
REACHED.push(['if, $dynamicRef to no anchor', { $schema: D2020, if: { $dynamicRef: '#nope' }, then: { type: 'string' } }, 1, '#nope', '$dynamicRef', 'abort'])

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
REACHED.push(['SchemaStore minecraft-texture-mcmeta negative test', MINECRAFT, { animation: ANIMATION, fusion: { layout: 'compact', render_type: 'opaque', type: 'connecting' } }, MINECRAFT_REF, '$ref', 'abort'])

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
  assert.strictEqual(e.schemaPath, '#', `${where}: the validation's error, at the root`)
  assert.strictEqual(e.params.ref, ref, where)
  assert.ok(e.message.includes(ref), `${where}: message names the reference: ${e.message}`)
}
// A result against the case's answer.
function answers(r, [label, , , ref, kw, answer], where) {
  if (answer === 'abort') assertRefError(r, ref, kw, `${label}: ${where}`)
  else assert.strictEqual(r.valid, answer === 'accept', `${label}: ${where}, got ${names(r)}`)
}
const ok = (x) => x[5] === 'accept'

console.log('unresolved references fail closed where failing in place could accept\n')

check(`${REACHED.length} reached cases: validate and isValidObject, on every engine`, () => {
  for (const c of REACHED) {
    const [label, s, d] = c
    const v = new Validator(s)
    assert.strictEqual(v.isValidObject(d), ok(c), `${label}: isValidObject`)
    answers(v.validate(d), c, 'validate')
    // The interpreted engine, cold (the plain walk) and past its tier.
    const cold = new Validator(s, { engine: 'interpreter' })
    assert.strictEqual(cold.isValidObject(d), ok(c), `${label}: interpreter isValidObject`)
    const first = cold.validate(d)
    answers(first, c, 'interpreter validate')
    assert.deepStrictEqual(v.validate(d).errors.map((e) => [e.instancePath, e.schemaPath]), first.errors.map((e) => [e.instancePath, e.schemaPath]), `${label}: same places`)
    for (let i = 0; i < 1100; i++) cold.isValidObject(d)
    assert.strictEqual(cold.isValidObject(d), ok(c), `${label}: warm isValidObject`)
    assert.deepStrictEqual(cold.validate(d).errors, first.errors, `${label}: warm validate`)
    // The engine directly, with the closure tree asked for at once: built
    // unless a reference stands where its failure could be inverted.
    const it = core.createInterpreter(v._schemaObj, { tier: 0 })
    assert.strictEqual(it.isValid(d), ok(c), `${label}: tier 0 isValid`)
    answers(it.validate(d), c, 'tier 0 validate')
    const neg = hasNegativeRef(v._schemaObj, null)
    if (c[5] === 'abort') assert.ok(neg, `${label}: a reference whose failure could be inverted`)
    assert.strictEqual(it._fast === null, neg, `${label}: closure tree ${it._fast === null ? 'not ' : ''}built`)
  }
})

check('reached cases: the JSON text readers, short and past 8 KB, and the scanner', () => {
  for (const c of REACHED) {
    const [label, s, d] = c
    const v = new Validator(s)
    const text = JSON.stringify(d)
    for (const t of [text, pad(text)]) {
      assert.strictEqual(v.isValidJSON(t), ok(c), `${label}: isValidJSON (${t.length})`)
      answers(v.validateJSON(t), c, `validateJSON (${t.length})`)
    }
    // Past the calls after which the scanner is built.
    for (let i = 0; i < 70; i++) v.isValidJSON(text)
    assert.strictEqual(v.isValidJSON(text), ok(c), `${label}: isValidJSON warm`)
    assert.strictEqual(new Validator(s, { abortEarly: true }).validateJSON(text).valid, ok(c), `${label}: validateJSON abortEarly`)
    assert.strictEqual(compileScanner(v._schemaObj), null, `${label}: the scanner declines`)
  }
})

check('reached cases: compat, the stream and the buffer readers', () => {
  for (const c of REACHED) {
    const [label, s, d, ref] = c
    for (const allErrors of [true, false]) {
      const f = new Compat({ strict: false, allErrors }).compile(structuredClone(s))
      assert.strictEqual(f(structuredClone(d)), ok(c), `${label}: compat allErrors ${allErrors}`)
      if (c[5] === 'abort' && allErrors) assert.ok(f.errors.some((e) => e.params && e.params.ref === ref), `${label}: compat names the reference`)
    }
    const v = new Validator(s)
    for (const format of ['ndjson', 'array']) {
      const st = v.stream({ format })
      st.push(format === 'ndjson' ? ndjsonOf(d) : JSON.stringify([d, d]))
      assert.strictEqual(st.end().valid, ok(c), `${label}: stream ${format}`)
    }
    assert.strictEqual(bufferNeedsSlowPath(v._schemaObj, new Map()), true, `${label}: buffer gate routes it`)
    const text = JSON.stringify(d)
    const n = ok(c) ? 1 : 0
    assert.strictEqual(v.isValid(Buffer.from(text)), ok(c), `${label}: isValid`)
    assert.strictEqual(v.isValid(Buffer.from(pad(text))), ok(c), `${label}: isValid past 8 KB`)
    assert.strictEqual(v.countValid(Buffer.from(ndjsonOf(d))), 2 * n, `${label}: countValid`)
    assert.deepStrictEqual(v.isValidNDJSON(Buffer.from(ndjsonOf(d))), [ok(c), ok(c)], `${label}: isValidNDJSON`)
    assert.deepStrictEqual(v.isValidParallel(Buffer.from(ndjsonOf(d))), [ok(c), ok(c)], `${label}: isValidParallel`)
    assert.strictEqual(v.batchIsValid([Buffer.from(text)]), n, `${label}: batchIsValid`)
    const padded = Buffer.alloc(text.length + 64)
    padded.write(text)
    assert.strictEqual(v.isValidPrepadded(padded, text.length), ok(c), `${label}: isValidPrepadded`)
    assert.strictEqual(v.validateAndParse(text).valid, ok(c), `${label}: validateAndParse`)
  }
})

check('the native walker keeps a schema whose local references all resolve; one that names nothing routes', () => {
  assert.strictEqual(bufferNeedsSlowPath({ not: { $ref: '#/$defs/a' }, $defs: { a: { type: 'string' } } }, new Map()), false)
  assert.strictEqual(bufferNeedsSlowPath({ properties: { a: { $ref: '#/$defs/nope' } } }, new Map()), true)
})

check('reached cases: every generator and module form declines, as at 0eff4af', () => {
  for (const c of REACHED) {
    const [label, s, d] = c
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
    // A bundle's empty slot is answered at load by a Validator.
    const [loaded] = Validator.loadBundle([null], [s])
    assert.strictEqual(loaded.isValidObject(d), ok(c), `${label}: loadBundle`)
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
    assert.strictEqual(verdict, ok(local[i]), `${local[i][0]}: twin isValidObject`)
    assert.strictEqual(valid, ok(local[i]), `${local[i][0]}: twin validate`)
    if (local[i][5] === 'abort') assert.strictEqual(kw, '$ref', `${local[i][0]}: twin error`)
    if (onTwin) twin++
  })
  assert.ok(twin > 0, 'the twin answered some of them')
})

// Mutants: each puts back what a path did before, and the cases above must
// tell it apart. A module compiled from altered source, as a file of lib/ so
// its own requires resolve.
function loadMutant (file, from, to) {
  const src = fs.readFileSync(path.join(LIB, file), 'utf8')
  assert.ok(src.includes(from), `${file}: the mutated text is there: ${from}`)
  const m = new Module(path.join(LIB, 'mutant-' + file))
  m.filename = path.join(LIB, 'mutant-' + file)
  m.paths = Module._nodeModulePaths(LIB)
  m._compile(src.split(from).join(to), m.filename)
  return m.exports
}
const byLabel = (prefix) => REACHED.filter((x) => x[4] === '$ref' && x[0].startsWith(prefix + ','))
const NOT_IF = () => [...byLabel('not'), ...byLabel('if')]

check('mutant: the interpreted engine failing only the subschema at the reference', () => {
  const mutant = loadMutant('interpreter-core.js', 'if (this._inv > 0 && this._abort === null) this._abort =', 'if (false) this._abort =')
  for (const [label, s, d] of NOT_IF()) {
    const n = new Validator(s)._schemaObj
    assert.strictEqual(core.createInterpreter(n).isValid(d), false, `${label}: the engine refuses`)
    assert.strictEqual(mutant.createInterpreter(n).isValid(d), true, `${label}: the mutant accepts, so this case catches it`)
    assert.strictEqual(mutant.createInterpreter(n).validate(d).valid, true, `${label}: the mutant accepts`)
  }
})

check('mutant: the walk taking a reference under not for a positive one', () => {
  const mutant = loadMutant('interpreter-core.js', '        this._inv++;\n        const no = this.eval(P.not', '        const no = this.eval(P.not')
  for (const [label, s, d] of byLabel('not')) {
    assert.strictEqual(mutant.createInterpreter(new Validator(s)._schemaObj).isValid(d), true, `${label}: the mutant accepts, so this case catches it`)
  }
})

check('mutant: the schema pass (native routing, ata-validator/ir) taking a reference under not for a positive one', () => {
  const mutant = loadMutant('negative-refs.js', "(k === 'not' || ", '(')
  for (const [label, s] of byLabel('not')) {
    const n = new Validator(s)._schemaObj
    assert.strictEqual(hasNegativeRef(n, null), true, `${label}: the pass finds it`)
    assert.strictEqual(mutant.hasNegativeRef(n, null), false, `${label}: the mutant does not, so this case catches it`)
  }
})

// Runs `fn` with a mutated closure compiler installed, then puts the real one back.
function withPlanMutant (from, to, fn) {
  const mutant = loadMutant('plan-compiler.js', from, to)
  try {
    core._setPlanCompiler(() => mutant.install)
    fn()
  } finally {
    core._setPlanCompiler(() => require(path.join(LIB, 'plan-compiler')).install)
  }
}
const tree = (s) => core.createInterpreter(new Validator(s)._schemaObj, { tier: 0 })

check('mutant: the closure tree built for a reference whose failure could be inverted', () => {
  withPlanMutant('if (ctx.inv > 0) ctx.neg = true;', '', () => {
    for (const [label, s, d] of NOT_IF()) assert.strictEqual(tree(s).isValid(d), true, `${label}: the mutant tree accepts, so this case catches it`)
  })
  for (const [label, s, d] of NOT_IF()) assert.strictEqual(tree(s).isValid(d), false, `${label}: the engine refuses`)
})

check('mutant: the verdict walk trying anyOf branches after one that passes', () => {
  const mutant = loadMutant('interpreter-core.js', '          if (ok && !collect) break;', '          if (this.coerce !== false && ok && !collect) break;')
  for (const [label, s, d] of byLabel('anyOf whose later branch negates it, after one that passes')) {
    const it = mutant.createInterpreter(new Validator(s)._schemaObj)
    assert.notStrictEqual(it.isValid(d), it.validate(d).valid, `${label}: the mutant's isValid and validate disagree, so this case catches it`)
  }
})

;(async () => {
  // ata-validator/ir is ESM: each of its backends refuses an abort case and
  // answers the others as the Validator does, when it takes them.
  const ir = await import(require('url').pathToFileURL(path.join(LIB, 'ir/index.mjs')).href)
  const refused = (fn) => { try { return fn() === null ? null : fn() } catch (e) { if (typeof e.message === 'string' && e.message.startsWith('ir:')) return null; throw e } }
  for (const c of REACHED) {
    const [label, s, d] = c
    for (const [name, mk] of [['specialize', () => ir.compileClosures(s, {})]]) {
      const e = refused(mk)
      if (c[5] === 'abort') assert.strictEqual(e, null, `${label}: ir ${name} refuses`)
      else if (e !== null) assert.strictEqual(e.isValid(structuredClone(d)), ok(c), `${label}: ir ${name}`)
    }
    if (c[5] === 'abort') {
      assert.strictEqual(refused(() => ir.specialize(s, { verdict: true })), null, `${label}: ir specialize`)
      assert.strictEqual(refused(() => ir.tableModule(s, {})), null, `${label}: ir table`)
      assert.strictEqual(refused(() => ir.closureModule(s, { richErrors: false })), null, `${label}: ir closure module`)
    }
  }
  console.log('  PASS  reached cases: ir refuses the abort cases and agrees on the rest')
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
