'use strict'

// `assertFormat: false` reads every format as an annotation, wherever the
// schema that carries it sits. It did not: the formats were taken out along
// the keywords that hold schemas, so one reached by `$ref` through any other
// place (a holder inside `definitions`, which is how SchemaStore's travis
// schema is written, an unknown keyword, a document given through `schemas`,
// addSchema() or a meta-schema) was still asserted, and by every path alike,
// since every path reads the schema the Validator prepared.
//
// Held here, for each of those shapes and on every path that answers for a
// schema: a string that only breaks the format is accepted, exactly as the
// same document with a well-formed string is; a document wrong for another
// reason is still refused, and none of its errors is a format's; a default
// Validator built from the same objects, before or after, still asserts.
// Then the gate (scripts/gate.js) over the official suite with the option
// on every path, against a Validator that does not use the option: a default
// one whose formats all accept.
//
// Run again by this file with code generation refused, where the interpreted
// engine answers.

const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const NO_EVAL = process.argv.includes('--no-eval-child')
const { Validator } = require(ROOT)
// lib/validator-core.js counts on the table's twelve keys (8 * KIND.size - 88).
assert.strictEqual(require(path.join(ROOT, 'lib/keywords.js')).KIND.size, 12, 'the key table as lib/validator-core.js reads it')

const F = { type: 'string', format: 'uri' }
const D2020 = 'https://json-schema.org/draft/2020-12/schema'
const D2019 = 'https://json-schema.org/draft/2019-09/schema'
const D7 = 'http://json-schema.org/draft-07/schema#'
const D4 = 'http://json-schema.org/draft-04/schema#'
const N = { type: 'number' }
// The documents: `bad` breaks only the format, `good` nothing, `other`
// breaks the format and a rule that is not one.
const DOCS = { bad: { u: 'a b' }, good: { u: 'http://a.b/' }, other: { u: 'a b', n: 'x' }, type: { u: [1] } }
const at = (doc) => ({ docs: { bad: { u: { w: 'a b' } }, good: { u: { w: 'http://a.b/' } }, other: { u: { w: 'a b' }, n: 'x' }, type: { u: { w: [1] } } }, ...doc })

// name: { schema, schemas?, docs?, add? } (`add`: registered with addSchema()).
const SHAPES = {
  'under $defs, the keyword': { schema: { $defs: { url: F }, properties: { u: { $ref: '#/$defs/url' }, n: N } } },
  'a holder inside definitions': { schema: { definitions: { holder: { url: F } }, type: 'object', properties: { u: { $ref: '#/definitions/holder/url' }, v: F, n: N } } },
  'a holder inside $defs, 2020-12': { schema: { $schema: D2020, $defs: { holder: { url: F } }, properties: { u: { $ref: '#/$defs/holder/url' }, n: N } } },
  'a holder inside definitions, draft-07': { schema: { $schema: D7, definitions: { holder: { url: F } }, properties: { u: { $ref: '#/definitions/holder/url' }, n: N } } },
  'a holder inside definitions, draft-04': { schema: { $schema: D4, definitions: { holder: { url: F } }, properties: { u: { $ref: '#/definitions/holder/url' }, n: N } } },
  'an unknown keyword': { schema: { stuff: { url: F }, properties: { u: { $ref: '#/stuff/url' }, n: N } } },
  'nested containers and an array': { schema: { stuff: { a: { b: [{ c: F }] } }, properties: { u: { $ref: '#/stuff/a/b/0/c' }, n: N } } },
  'a reference chain through two holders': { schema: { stuff: { a: { $ref: '#/other/b' } }, other: { b: F }, properties: { u: { $ref: '#/stuff/a' }, n: N } } },
  'a keyword inside the target': at({ schema: { stuff: { a: { type: 'object', properties: { w: F } } }, properties: { u: { $ref: '#/stuff/a' }, n: N } } }),
  'a holder named like a data keyword': { schema: { definitions: { default: F, enum: F }, properties: { u: { allOf: [{ $ref: '#/definitions/default' }, { $ref: '#/definitions/enum' }] }, n: N } } },
  'a property named default': { schema: { properties: { u: { type: 'object', properties: { default: F, examples: F } }, n: N } }, docs: { bad: { u: { default: 'a b', examples: 'a b' } }, good: { u: { default: 'http://a.b/' } }, other: { u: { default: 'a b' }, n: 'x' }, type: { u: { default: [1] } } } },
  'a registered document': { schema: { properties: { u: { $ref: 'http://x/y.json' }, n: N } }, schemas: [{ $id: 'http://x/y.json', ...F }] },
  'a registered document, by key': { schema: { properties: { u: { $ref: 'http://x/y.json' }, n: N } }, schemas: { 'http://x/y.json': { ...F } } },
  'a holder in a registered document': { schema: { properties: { u: { $ref: 'http://x/y.json#/stuff/url' }, n: N } }, schemas: [{ $id: 'http://x/y.json', stuff: { url: F } }] },
  '$defs in a registered document': { schema: { properties: { u: { $ref: 'http://x/y.json#/$defs/url' }, n: N } }, schemas: [{ $id: 'http://x/y.json', $defs: { url: F } }] },
  'a registered document that refers on': { schema: { properties: { u: { $ref: 'http://x/a.json' }, n: N } }, schemas: [{ $id: 'http://x/a.json', $ref: 'http://x/b.json#/held/url' }, { $id: 'http://x/b.json', held: { url: F } }] },
  'a draft-07 registered document': { schema: { $schema: D7, properties: { u: { $ref: 'http://x/y.json#/definitions/holder/url' }, n: N } }, schemas: [{ $id: 'http://x/y.json', definitions: { holder: { url: F } } }] },
  'addSchema()': { schema: { properties: { u: { $ref: 'http://x/y.json#/stuff/url' }, n: N } }, add: [{ $id: 'http://x/y.json', stuff: { url: F } }] },
  '$dynamicRef': { schema: { $schema: D2020, $id: 'http://x/r', $defs: { a: { $dynamicAnchor: 'n', ...F } }, properties: { u: { $dynamicRef: '#n' }, n: N } } },
  '$dynamicRef with a pointer to a holder': { schema: { $schema: D2020, $id: 'http://x/r', stuff: { a: F }, properties: { u: { $dynamicRef: '#/stuff/a' }, n: N } } },
  '$recursiveRef': { schema: { $schema: D2019, $recursiveAnchor: true, type: ['object', 'string', 'number'], format: 'uri', properties: { u: { $recursiveRef: '#' }, n: N } }, docs: { bad: { u: 'a b' }, good: { u: 'http://a.b/' }, other: { u: 'a b', n: { n: 'x' } }, type: { u: [1] } } },
  'an embedded resource with a holder': { schema: { $schema: D2020, $id: 'http://x/r', $defs: { e: { $id: 'http://x/q', held: { url: F }, $ref: '#/held/url' } }, properties: { u: { $ref: 'q' }, n: N } } },
  // `weak`: generated code does not assert the formats of the draft-07
  // meta-schema under default options either, where the interpreted engine
  // does. Another matter than this option; the default control below is the
  // interpreted engine's for this shape.
  'a meta-schema': { weak: true, schema: { $schema: D7, type: 'object', properties: { u: { $ref: D7 }, n: N } }, docs: { bad: { u: { $id: 'a b' } }, good: { u: { $id: 'http://a.b/' } }, other: { u: { $id: 'a b' }, n: 'x' }, type: { u: { type: 5 } } } },
  'a 2020-12 meta-schema': { schema: { $schema: D2020, type: 'object', properties: { u: { $ref: D2020 }, n: N } }, docs: { bad: { u: { $id: 'a b' } }, good: { u: { $id: 'http://a.b/' } }, other: { u: { $id: 'a b' }, n: 'x' }, type: { u: { type: 5 } } } },
}

const clone = (x) => structuredClone(x)
const loadCjs = (src) => { const m = new Module('assert-format-off'); m.filename = path.join(ROOT, 'assert-format-off-module.cjs'); m.paths = Module._nodeModulePaths(ROOT); m._compile(src, m.filename); return m.exports }
const formatErrors = (errors) => (errors || []).reduce((n, e) => n + (e.keyword === 'format' ? 1 : 0) + formatErrors(e.branchErrors), 0)

// A path: build(shape, options) returns { valid(doc), errors(doc)? } or null
// where it declines. `options` always holds assertFormat: false.
const optionsOf = (shape, extra) => ({ assertFormat: false, ...(shape.schemas ? { schemas: shape.schemas } : {}), ...extra })
function make(V, shape, extra) {
  const v = new V(clone(shape.schema), optionsOf(shape, extra))
  for (const s of shape.add || []) v.addSchema(clone(s))
  return v
}
// The 2.0 Validator refuses a schema that needs a feature its entry does not
// carry ("ata2: ..."): declined, and counted as that.
const declines = (group) => Object.fromEntries(Object.entries(group).map(([k, f]) => [k, (shape) => {
  try { const p = f(shape); p.valid(clone((shape.docs || DOCS).good)); return p } catch (e) { if (/^ata2:/.test(String(e && e.message))) return null; throw e }
}]))
const methods = (V, extra) => ({
  validate: (shape) => { const v = make(V, shape, extra); return { valid: (d) => v.validate(d).valid, errors: (d) => v.validate(d).errors } },
  isValidObject: (shape) => { const v = make(V, shape, extra); return { valid: (d) => v.isValidObject(d) } },
  'after 1200 calls': (shape) => { const v = make(V, shape, extra); for (let i = 0; i < 1200; i++) v.isValidObject(i % 2 ? {} : []); return { valid: (d) => v.isValidObject(d) && v.validate(clone(d)).valid, errors: (d) => v.validate(d).errors } },
  validateJSON: (shape) => { const v = make(V, shape, extra); return { valid: (d) => v.validateJSON(JSON.stringify(d)).valid, errors: (d) => v.validateJSON(JSON.stringify(d)).errors } },
  isValidJSON: (shape) => { const v = make(V, shape, extra); return { valid: (d) => v.isValidJSON(JSON.stringify(d)) } },
})
// The buffer APIs, which the native engine answers where the addon is built.
const buffers = (extra) => ({
  'isValid(Buffer)': (shape) => { const v = make(Validator, shape, extra); return { valid: (d) => v.isValid(Buffer.from(JSON.stringify(d))) } },
  countValid: (shape) => { const v = make(Validator, shape, extra); return { valid: (d) => v.countValid(Buffer.from(JSON.stringify(d) + '\n')) === 1 } },
  isValidParallel: (shape) => { const v = make(Validator, shape, extra); return { valid: (d) => { const r = v.isValidParallel(Buffer.from(JSON.stringify(d) + '\n')); return Array.isArray(r) ? r[0] === true : r === true } } },
  validateAndParse: (shape) => { const v = make(Validator, shape, extra); return { valid: (d) => v.validateAndParse(Buffer.from(JSON.stringify(d))).valid } },
})

const PATHS = {}
const add = (prefix, group) => { for (const [k, f] of Object.entries(group)) PATHS[prefix ? `${prefix}: ${k}` : k] = f }
add('', methods(Validator))
add('interpreted engine', methods(Validator, { engine: 'interpreter' }))
add('plain errors', methods(Validator, { richErrors: false }))
add('abortEarly', methods(Validator, { abortEarly: true }))
add('coerceTypes', { validate: methods(Validator, { coerceTypes: true }).validate, isValidObject: methods(Validator, { coerceTypes: true }).isValidObject })
add('removeAdditional', { validate: methods(Validator, { removeAdditional: true }).validate })
add('useDefaults off', { validate: methods(Validator, { useDefaults: false }).validate })
add('buffer', buffers())
add('ata-validator/lite', methods(require(path.join(ROOT, 'lite.js')).Validator))
add('edge entry', methods(require(path.join(ROOT, 'index.edge.js')).Validator))
// The 2.0 Validator: the plugin's core with every feature registered
// (lib/validator-small.js on lib/engine-small.js and lib/core/verdict.js),
// and below the full entries (lib/validator-full.js on lib/engine-full.js).
{
  const Small = require(path.join(ROOT, 'lib/validator-small.js')).Validator
  const f = require(path.join(ROOT, 'lib/features/groups.js')).all
  // On the plugin's core the option is the formatsOff feature: without it a
  // validator that sets the option is refused by name, schema with a format
  // or without, and featuresFor() names it whenever the option is false.
  for (const schema of [{ type: 'string', format: 'uri' }, { type: 'string' }]) {
    assert.throws(() => new Small(schema, { assertFormat: false }).isValidObject('a b'), /ata2: .*formatsOff, Validator\.use\(formatsOff\)/, 'the core refuses assertFormat: false without the feature')
    assert.strictEqual(new Small({ type: 'string' }).isValidObject('a b'), true, 'and takes a validator that does not set it')
  }
  Small.use(...f, require(path.join(ROOT, 'lib/features/metaschemas.js')).metaschemas, require(path.join(ROOT, 'lib/features/richErrors.js')).richErrors, require(path.join(ROOT, 'lib/features/formatsOff.js')).formatsOff)
  add('2.0 core, every feature', declines(methods(Small)))
  add('2.0 core, every feature, plain errors', declines(methods(Small, { richErrors: false })))
  add('2.0 core, every feature, abortEarly', declines({ validate: methods(Small, { abortEarly: true }).validate }))
}

if (!NO_EVAL) {
  // The three code generators and the closure compiler, each called as the
  // Validator calls it: on the schema and the registry it prepared. None takes
  // the option, so the option is honoured for them only if it is honoured
  // there. A generator that declines is counted, not passed.
  const jsc = require(path.join(ROOT, 'lib/js-compiler'))
  const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) })
  const prepared = (shape) => { const v = make(Validator, shape); v._ensureCompiled(); return [v._schemaObj, v._schemaMap.size > 0 ? v._schemaMap : null] }
  PATHS['compileToJSCodegen'] = (shape) => { const [s, m] = prepared(shape); const fn = jsc.compileToJSCodegen(s, m, null); return fn ? { valid: (d) => fn(d) === true } : null }
  PATHS['compileToJSCombined'] = (shape) => { const [s, m] = prepared(shape); const fn = jsc.compileToJSCombined(s, VALID, m, null); return fn ? { valid: (d) => fn(d).valid === true, errors: (d) => fn(d).errors } : null }
  PATHS['compileToJSCodegenWithErrors'] = (shape) => { const [s, m] = prepared(shape); const fn = jsc.compileToJSCodegenWithErrors(s, m, null); return fn ? { valid: (d) => fn(d, true).valid === true, errors: (d) => fn(d, true).errors } : null }
  PATHS['compileToJS'] = (shape) => { const [s, m] = prepared(shape); const fn = jsc.compileToJS(s, null, m); return fn ? { valid: (d) => fn(d) === true } : null }

  // The modules a build writes, and the wrappers that load them.
  const aot = require(path.join(ROOT, 'lib/aot-impl'))
  const moduleOf = (shape, opts) => { const v = make(Validator, shape); const src = aot.toStandaloneModule(v, { format: 'cjs', onWarning () {}, ...opts }); return src ? loadCjs(src) : null }
  PATHS['module'] = (shape) => { const m = moduleOf(shape, { order: true }); return m ? { valid: (d) => m.isValid(d) && m.validate(clone(d)).valid, errors: (d) => m.validate(d).errors } : null }
  PATHS['module, one pass'] = (shape) => { const m = moduleOf(shape, { onePass: true }); return m ? { valid: (d) => m.isValid(d) && m.validate(clone(d)).valid, errors: (d) => m.validate(d).errors } : null }
  // bundleStandalone: one function per schema, built from the validator's
  // options. bundle() and loadBundle(): the modules fromStandalone() wraps.
  PATHS['bundleStandalone'] = (shape) => {
    if (shape.add) return null
    const fns = loadCjs(Validator.bundleStandalone([clone(shape.schema)], { format: 'cjs', ...optionsOf(shape) }))
    const f = fns[0]
    return typeof f === 'function' ? { valid: (d) => f(d).valid === true, errors: (d) => f(d).errors } : null
  }
  PATHS['bundle, loaded'] = (shape) => {
    if (shape.add) return null
    const mods = loadCjs(Validator.bundle([clone(shape.schema)], optionsOf(shape)))
    if (!mods[0]) return null
    const [v] = Validator.loadBundle(mods, [clone(shape.schema)], optionsOf(shape))
    return { valid: (d) => v.isValidObject(d) && v.validate(clone(d)).valid, errors: (d) => v.validate(d).errors }
  }
  // fromStandalone over a module with no error function: it compiles one
  // from the schema it is given, which has to lose its formats too.
  PATHS['fromStandalone, errors compiled on load'] = (shape) => {
    if (shape.add) return null
    const made = make(Validator, shape); made._ensureCompiled()
    const [s, m] = [made._schemaObj, made._schemaMap.size > 0 ? made._schemaMap : null]
    const boolFn = jsc.compileToJSCodegen(s, m, null)
    if (!boolFn) return null
    const v = Validator.fromStandalone({ boolFn }, clone(shape.schema), optionsOf(shape))
    return { valid: (d) => v.isValidObject(d) && v.validate(clone(d)).valid, errors: (d) => v.validate(d).errors }
  }
  PATHS['compat, validateFormats: false'] = (shape) => {
    const { Ajv } = require(path.join(ROOT, 'compat.js'))
    const ajv = new Ajv({ validateFormats: false, strict: false })
    const list = shape.add || (Array.isArray(shape.schemas) ? shape.schemas : null)
    if (list) for (const s of list) ajv.addSchema(clone(s))
    else if (shape.schemas) for (const [k, s] of Object.entries(shape.schemas)) ajv.addSchema(clone(s), k)
    const fn = ajv.compile(clone(shape.schema))
    return { valid: (d) => fn(d) === true, errors: (d) => { fn(d); return fn.errors } }
  }
}

async function main () {
  {
    const url = (f) => require('node:url').pathToFileURL(path.join(ROOT, f)).href
    const features = await import(url('index.v2.features.mjs'))
    for (const schema of [{ type: 'string', format: 'uri' }, { type: 'string' }, { $ref: 'http://x/y.json' }]) {
      const schemas = [{ $id: 'http://x/y.json', type: 'string', format: 'uri' }]
      assert.ok(features.featuresFor(schema, { assertFormat: false, schemas }).includes('formatsOff'), 'featuresFor names formatsOff when the option is false')
      assert.ok(!features.featuresFor(schema, { schemas }).includes('formatsOff'), 'and not otherwise')
    }
    // With the option the formats are gone before the other questions are asked: no format feature is named.
    assert.deepStrictEqual(features.featuresFor({ type: 'string', format: 'uri' }, { assertFormat: false }), ['formatsOff'])
    for (const [label, file] of [['2.0 browser entry', 'index.v2.browser.mjs'], ['2.0 edge entry', 'index.v2.edge.mjs']]) {
      const V = (await import(url(file))).Validator
      V.use(features.metaschemas)
      add(label, declines(methods(V)))
      add(label + ', plain errors', declines(methods(V, { richErrors: false })))
    }
  }
  if (!NO_EVAL) {
    const browser = await import(require('node:url').pathToFileURL(path.join(ROOT, 'index.browser.mjs')).href)
    add('browser entry', methods(browser.Validator))
    // ata-validator/ir skips every format at lowering; it must agree.
    const ir = await import(require('node:url').pathToFileURL(path.join(ROOT, 'lib/ir/index.mjs')).href)
    const refused = (e) => e && typeof e.message === 'string' && e.message.startsWith('ir:')
    PATHS['ir closures'] = (shape) => { if (shape.schemas || shape.add) return null; let c; try { c = ir.compileClosures(clone(shape.schema), { assertFormat: false }) } catch (e) { if (refused(e)) return null; throw e } return c ? { valid: (d) => c.isValid(d) && c.validate(clone(d)).valid, errors: (d) => c.validate(d).errors } : null }
  }

  let checks = 0; let taken = 0; let declined = 0
  // Buffer cells where the buffer API accepts the well-formed document, so
  // the cell says something about formats, and those where it refuses it.
  let bufferTold = 0; let bufferRefused = 0
  const perPath = {}
  for (const [pname, build] of Object.entries(PATHS)) {
    perPath[pname] = 0
    for (const [sname, shape] of Object.entries(SHAPES)) {
      const where = `${pname} | ${sname}`
      const docs = shape.docs || DOCS
      const p = build(shape)
      if (p === null) { declined++; continue }
      taken++; perPath[pname]++
      // The buffer APIs are compared with themselves under default options:
      // the native engine does not follow a pointer to a holder at all
      // (a refusal of the well-formed document too, with or without the
      // option), which is another matter than formats.
      const isBuffer = pname.startsWith('buffer')
      let good = true; let type = false
      if (isBuffer) {
        const base = buffers.call(null, { assertFormat: undefined })[pname.slice('buffer: '.length)](shape)
        good = base.valid(clone(docs.good)); type = base.valid(clone(docs.type))
        if (good) bufferTold++; else bufferRefused++
      }
      assert.strictEqual(p.valid(clone(docs.good)), good, `${where}: the well-formed document`)
      assert.strictEqual(p.valid(clone(docs.bad)), good, `${where}: a document only the format refuses is answered as the well-formed one`)
      assert.strictEqual(p.valid(clone(docs.type)), type, `${where}: a value of the wrong type is still refused`)
      assert.strictEqual(p.valid(clone(docs.other)), false, `${where}: a document wrong for another reason is still refused`)
      checks += 4
      if (p.errors) {
        const errors = p.errors(clone(docs.other))
        assert.ok(Array.isArray(errors) && errors.length > 0, `${where}: errors for the refused document`)
        assert.strictEqual(formatErrors(errors), 0, `${where}: none of its errors is a format's: ${JSON.stringify(errors).slice(0, 300)}`)
        checks++
      }
    }
  }
  // Every path took the first shape, and the paths that answer for any
  // schema took them all.
  for (const [pname, n] of Object.entries(perPath)) assert.ok(n > 0, `${pname} took no shape`)
  for (const pname of ['validate', 'isValidObject', 'after 1200 calls', 'validateJSON', 'isValidJSON', 'interpreted engine: validate', 'plain errors: validate', 'ata-validator/lite: validate', 'edge entry: validate', '2.0 core, every feature: validate', '2.0 core, every feature: isValidObject', '2.0 browser entry: validate', '2.0 browser entry: isValidObject', '2.0 edge entry: validate', '2.0 edge entry: isValidObject']) {
    assert.strictEqual(perPath[pname], Object.keys(SHAPES).length, `${pname} answers every shape`)
  }

  // The default Validator is untouched by one built with the option from the
  // same objects, in either order, and the caller's objects are not changed.
  for (const V of [Validator, require(path.join(ROOT, 'lib/validator-small.js')).Validator]) for (const [sname, shape] of Object.entries(SHAPES)) {
    if (shape.add || (shape.weak && V !== Validator)) continue
    const docs = shape.docs || DOCS
    for (const offFirst of [true, false]) {
      const schema = clone(shape.schema); const schemas = shape.schemas ? clone(shape.schemas) : undefined
      const before = JSON.stringify([schema, schemas])
      const mk = (off) => new V(schema, { ...(schemas ? { schemas } : {}), ...(off ? { assertFormat: false } : shape.weak ? { engine: 'interpreter' } : {}) })
      const a = mk(offFirst); const b = mk(!offFirst)
      const [off, on] = offFirst ? [a, b] : [b, a]
      for (let i = 0; i < 2; i++) {
        assert.strictEqual(off.validate(clone(docs.bad)).valid, true, `${sname}: accepted with the option`)
        assert.strictEqual(on.validate(clone(docs.bad)).valid, false, `${sname}: a default Validator from the same objects still asserts the format`)
        assert.strictEqual(on.isValidObject(clone(docs.bad)), false, `${sname}: and so does its verdict`)
        assert.strictEqual(on.validate(clone(docs.good)).valid, true, `${sname}: and accepts the well-formed document`)
        checks += 4
      }
      // The errors of both come in the same order: neither lost the order
      // that follows a reference into a registered document.
      const order = (v) => v.validate(clone(docs.other)).errors.filter((e) => e.keyword !== 'format').map((e) => e.schemaPath).join(' ')
      const alone = new V(clone(shape.schema), { ...(schemas ? { schemas: clone(shape.schemas) } : {}), ...(shape.weak ? { engine: 'interpreter' } : {}) })
      assert.strictEqual(order(on), order(alone), `${sname}: the default Validator's error order is what it is alone`)
      assert.strictEqual(JSON.stringify([schema, schemas]), before, `${sname}: the caller's schema and documents are as they were`)
      checks += 2
    }
  }

  // What is data stays: a const or enum value with a `format` key, a default
  // that is filled, and the parameters under a data keyword.
  {
    const v = new Validator({ properties: { c: { const: { format: 'uri' } }, e: { enum: [{ format: 'x' }] }, d: { type: 'object', default: { format: 'kept' } } } }, { assertFormat: false })
    assert.strictEqual(v.validate({ c: { format: 'uri' }, e: { format: 'x' } }).valid, true, 'a const and an enum value keep their format key')
    assert.strictEqual(v.validate({ c: {} }).valid, false, 'the const is still compared whole')
    assert.strictEqual(v.validate({ e: {} }).valid, false, 'the enum is still compared whole')
    const doc = {}; v.validate(doc)
    assert.deepStrictEqual(doc.d, { format: 'kept' }, 'a default with a format key is filled whole')
    checks += 4
  }

  // A limit of the removal, held as it is so it does not change unseen.
  // A schema that is the direct child named `default`, `enum`, `const` or
  // `examples` of an object that is not a map of names is taken for that
  // keyword's data and keeps its format.
  {
    const held = { stuff: { default: F }, properties: { u: { $ref: '#/stuff/default' } } }
    assert.strictEqual(new Validator(held, { assertFormat: false }).isValidObject({ u: 'a b' }), false, 'a schema held under a data keyword\'s name keeps its format')
    assert.strictEqual(new Validator(held, { assertFormat: false }).isValidObject({ u: 'http://a.b/' }), true)
    // A custom keyword's value is its parameters, the caller's data: a string
    // `format` among them stays, with the option and without, in the root and
    // in a registered document, while the formats beside it go. A key of the
    // same name that no validator registered is an unknown keyword like any
    // other, and a schema under it loses its format.
    const seen = []
    const kw = { cur: { validate: (p) => { seen.push(p); return true } } }
    const root = () => ({ type: 'object', held: { url: F }, properties: { u: { type: 'string', cur: { format: 'iso', min: 1 } }, w: { $ref: '#/held/url' }, r: { $ref: 'http://x/k.json' } } })
    const doc = () => [{ $id: 'http://x/k.json', type: 'string', format: 'uri', cur: { format: 'iso', min: 2 } }]
    const before = new Validator({ zap: { url: F }, properties: { u: { $ref: '#/zap/url' } } }, { assertFormat: false })
    assert.strictEqual(before.isValidObject({ u: 'a b' }), true, 'an unregistered key holds schemas')
    for (const engine of [undefined, 'interpreter']) {
      for (const off of [true, false]) {
        seen.length = 0
        const v = new Validator(root(), { ...(off ? { assertFormat: false } : {}), ...(engine ? { engine } : {}), keywords: kw, schemas: doc() })
        assert.strictEqual(v.validate({ u: 'x', w: 'a b', r: 'a b' }).valid, off, `formats beside a custom keyword, assertFormat ${!off}`)
        assert.ok(seen.some((p) => p.format === 'iso' && p.min === 1), `the root's parameters reach the keyword whole (${JSON.stringify(seen)})`)
        assert.ok(seen.some((p) => p.format === 'iso' && p.min === 2), `and a registered document's (${JSON.stringify(seen)})`)
        checks += 3
      }
    }
    // The same schema object, first read by a validator that does not know
    // the keyword: the copy it made is not the one the keyword's validator reads.
    {
      const shared = { type: 'object', properties: { u: { type: 'string', late: { format: 'iso', min: 3 } }, v: F } }
      assert.strictEqual(new Validator(shared, { assertFormat: false }).validate({ u: 'x', v: 'a b' }).valid, true)
      seen.length = 0
      const v = new Validator(shared, { assertFormat: false, keywords: { late: kw.cur } })
      assert.strictEqual(v.validate({ u: 'x', v: 'a b' }).valid, true)
      assert.ok(seen.some((p) => p.format === 'iso' && p.min === 3), `a copy made before the keyword was registered is not reused (${JSON.stringify(seen)})`)
    }
    checks += 4
  }

  if (NO_EVAL) {
    console.log(`ok (code generation refused): assertFormat: false on ${Object.keys(PATHS).length} paths and ${Object.keys(SHAPES).length} shapes, ${taken} taken, ${declined} declined, ${checks} checks`)
    return
  }

  // The gate with the option on every path, over the official suite.
  const gate = require(path.join(ROOT, 'scripts/gate.js'))
  const r = await gate.run({ assertFormat: false })
  const paths = Object.entries(r.stats.paths)
  const bad = paths.reduce((n, [, s]) => n + s.diffs + s.threw, 0)
  assert.strictEqual(bad, 0, '\n' + gate.summary(r))
  const oracle = r.stats.paths['Validator, formats accepting']
  assert.ok(oracle && oracle.taken > 1700 && oracle.docs > 24000, 'the Validator whose formats all accept answered the suite')
  assert.ok(oracle.flipped > 1900, `documents only a format refused are accepted (${oracle.flipped})`)
  // The paths that take the option answer most of the suite; the three that
  // stand for a default Validator or refuse any option they do not know
  // decline every schema, which is not agreement and is not counted as it.
  const DECLINE_ALL = ['module, plain errors', 'compact module', 'schema module']
  for (const [name, s] of paths) {
    if (DECLINE_ALL.includes(name)) assert.strictEqual(s.taken, 0, `${name} takes no schema with an option`)
    else assert.ok(s.taken > 500 && s.docs > 10000, `${name} took ${s.taken} schemas and ${s.docs} documents`)
  }

  // The same shapes with code generation refused.
  const child = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', __filename, '--no-eval-child'], { encoding: 'utf8' })
  assert.strictEqual(child.status, 0, 'with code generation refused:\n' + child.stdout + child.stderr)

  console.log(`ok: assertFormat: false on ${Object.keys(PATHS).length} paths and ${Object.keys(SHAPES).length} shapes, ${taken} taken, ${declined} declined, ${checks} checks, the buffer APIs accepting the well-formed document in ${bufferTold} cells and refusing it in ${bufferRefused}; the gate with the option: ${r.stats.schemas} schemas, ${paths.length - 1 - DECLINE_ALL.length} paths taking it, ${paths.reduce((n, [, s]) => n + s.docs, 0)} documents, 0 differences, ${oracle.flipped} documents accepted that only a format refused`)
  process.stdout.write(child.stdout)
}

main().catch((e) => { console.error(e); process.exit(1) })
