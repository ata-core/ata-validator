'use strict'

// unevaluatedProperties and unevaluatedItems depend on which subschemas
// passed, and the code generator models that with a handful of shapes. A shape
// it did not model used to emit nothing, and nothing read as valid: with
// `{if: {properties: {foo: {const: 1}}}, unevaluatedProperties: false}` every
// object was accepted, `{bar: 1}` included, from 1.0.0 to 1.38.0. This test
// builds schemas from the applicators that produce annotations, in random
// combinations, and holds the generated verdict to the interpreter's on
// documents built from the names and values those schemas mention. The
// interpreter tracks annotations as the specification describes and passes
// the official suite; where the generator declines, the router uses it anyway.

const assert = require('assert')
const { compileToJSCodegen, compileToJSCodegenWithErrors } = require('../lib/js-compiler')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

// A standalone module, loaded the way a CommonJS consumer would, or null
// where the schema does not compile to one.
function loadModule (schema) {
  const src = toStandaloneModule(schema, { format: 'cjs' })
  if (src === null) return null
  const m = { exports: {} }
  new Function('module', 'exports', src)(m, m.exports)
  return m.exports
}

let seed = Number(process.env.SEED) || 0x2026 // xorshift stays at zero from a zero seed
const rnd = (k) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % k }
const pick = (a) => a[rnd(a.length)]

const NAMES = ['a', 'b', 'c', 'foo', 'bar']
const VALUES = [1, 2, 'x', true, null]

function leaf () {
  return pick([{}, { const: pick(VALUES) }, { type: pick(['string', 'integer', 'boolean']) }, true, false])
}
function props () {
  const o = {}
  for (let i = 0, n = 1 + rnd(2); i < n; i++) o[pick(NAMES)] = leaf()
  return o
}
function sub (depth, flat) {
  const s = {}
  const r = rnd(10)
  if (flat) {
    // The shapes the generator models: fixed names, maybe a required.
    if (r < 8) s.properties = props()
    if (rnd(3) === 0) s.required = [pick(NAMES)]
    return s
  }
  if (r < 5) s.properties = props()
  if (r >= 3 && r < 6) s.patternProperties = { ['^' + pick(NAMES).slice(0, 1)]: leaf() }
  if (rnd(4) === 0) s.required = [pick(NAMES)]
  if (depth < 2 && rnd(5) === 0) s.allOf = [sub(depth + 1)]
  if (depth < 2 && rnd(6) === 0) s[pick(['anyOf', 'oneOf'])] = [sub(depth + 1), sub(depth + 1)]
  if (depth < 1 && rnd(8) === 0) s.additionalProperties = leaf()
  return s
}
function root () {
  // Half the schemas use subschemas with fixed names only, which is what the
  // generator's models are written for; the rest mix in everything.
  const flat = rnd(2) === 0
  const sub0 = () => sub(0, flat)
  const s = {}
  if (rnd(2)) s.properties = props()
  if (rnd(4) === 0) s.patternProperties = { ['^' + pick(NAMES).slice(0, 1)]: leaf() }
  const kinds = ['if', 'ifThen', 'ifElse', 'ifThenElse', 'anyOf', 'oneOf', 'allOf', 'dependentSchemas', '$ref']
  for (let i = 0, n = 1 + rnd(2); i < n; i++) {
    const k = pick(kinds)
    if (k === 'if') s.if = sub0()
    else if (k === 'ifThen') { s.if = sub0(); s.then = sub0() }
    else if (k === 'ifElse') { s.if = sub0(); s.else = sub0() }
    else if (k === 'ifThenElse') { s.if = sub0(); s.then = sub0(); s.else = sub0() }
    else if (k === 'anyOf' || k === 'oneOf') s[k] = [sub0(), sub0()]
    else if (k === 'allOf') s.allOf = [sub0(), sub0()]
    else if (k === 'dependentSchemas') s.dependentSchemas = { [pick(NAMES)]: sub0() }
    else { s.$defs = { d: sub0() }; s.$ref = '#/$defs/d' }
  }
  // required next to additionalProperties: false, with names from the same
  // pool, so a required name can be one properties does not declare.
  if (rnd(5) === 0) { s.required = [pick(NAMES)]; s.additionalProperties = false }
  s.unevaluatedProperties = rnd(3) === 0 ? leaf() : false
  return s
}
function doc () {
  const o = {}
  for (let i = 0, n = rnd(4); i < n; i++) o[pick(NAMES)] = pick(VALUES)
  return o
}

// The three silent accepts this found, each present since at least 0.9.0.
for (const [schema, data] of [
  // a lone if with properties: no check was emitted at all
  [{ if: { properties: { foo: { const: 1 } } }, unevaluatedProperties: false }, { bar: 1 }],
  // anyOf was skipped next to unevaluatedProperties that is not false
  [{ anyOf: [{ required: ['a'] }, { required: ['b'] }], unevaluatedProperties: true }, {}],
  // counting keys under additionalProperties: false, with a required name
  // that properties does not declare
  [{ properties: { c: {} }, required: ['b'], additionalProperties: false }, { b: 1 }],
]) {
  const v = new Validator(schema)
  assert.strictEqual(new Validator(schema, { engine: 'interpreter' }).validate(data).valid, false)
  assert.strictEqual(v.validate(data).valid, false, JSON.stringify(schema))
  assert.strictEqual(v.isValidObject(data), false, JSON.stringify(schema))
  const mod = loadModule(schema)
  if (mod) assert.strictEqual(mod.isValid(data), false, 'standalone ' + JSON.stringify(schema))
}

const SCHEMAS = Number(process.env.SCHEMAS || 3000)
let generated = 0, compared = 0, modules = 0
const diffs = []
for (let i = 0; i < SCHEMAS; i++) {
  const schema = root()
  let fn, efn
  try { fn = compileToJSCodegen(schema) } catch { fn = null }
  try { efn = compileToJSCodegenWithErrors(schema) } catch { efn = null }
  const ref = new Validator(schema, { engine: 'interpreter' })
  const full = new Validator(schema)
  // Every tenth schema also goes through a standalone module, the path a
  // build step ships.
  const mod = i % 10 === 0 ? loadModule(schema) : null
  if (mod) modules++
  if (fn) generated++
  for (let j = 0; j < 12; j++) {
    const d = doc()
    const want = ref.validate(d).valid
    compared++
    const got = [
      ['generated', fn && fn(d)],
      ['generated errors', efn && efn(d, true).valid],
      ['validate()', full.validate(d).valid],
      ['isValidObject()', full.isValidObject(d)],
      ['standalone module', mod && mod.isValid(d)],
      ['standalone validate', mod && mod.validate(d).valid],
    ]
    for (const [path, v] of got) {
      if (v === null || v === undefined) continue
      if (v !== want) { diffs.push({ schema, d, want, path }); break }
    }
  }
}
for (const x of diffs.slice(0, 5)) console.log('DIFF', x.path, JSON.stringify(x.schema), JSON.stringify(x.d), 'interpreter', x.want)
assert.strictEqual(diffs.length, 0, diffs.length + ' verdicts differ from the interpreter')
assert.ok(generated > SCHEMAS / 5, 'only ' + generated + ' of ' + SCHEMAS + ' schemas went through the generator, so the comparison says little')
console.log(`ok: ${compared} documents over ${SCHEMAS} schemas get the interpreter's verdict on every path; ${generated} schemas were generated, ${modules} also ran as standalone modules`)
