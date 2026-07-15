'use strict'

// Schema-valued additionalProperties: the AOT error path used to bail and emit a
// single generic "validation failed", while the runtime path reports a precise
// per-property error (instancePath /<key>, the failing keyword). The compiled
// output must match the runtime so precompiled consumers (e.g. rjsf) get the
// same field-level errors.

const { Validator } = require('..')
const aot = require('../lib/aot')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }
function load(code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports }
function norm(errs) {
  return JSON.stringify((errs || []).map((e) => ({ k: e.keyword, p: e.instancePath })).sort((a, b) => (a.p + a.k).localeCompare(b.p + b.k)))
}

console.log('\nAOT error path: schema-valued additionalProperties\n')

const cases = [
  {
    name: 'type mismatch on additional value',
    schema: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'number' } },
    bad: { a: 'x', b: 'notnum', c: 'alsobad' },
  },
  {
    name: 'nested keyword (minimum) on additional value',
    schema: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } },
    bad: { x: -5, y: 3 },
  },
]

for (const { name, schema, bad } of cases) {
  const rt = new Validator(schema).validate(bad)
  const expected = norm(rt.errors)
  check(rt.valid === false, `${name}: runtime rejects (sanity)`)

  // toStandaloneModule
  const saCode = aot.toStandaloneModule(new Validator(schema), { format: 'cjs' })
  const sa = saCode ? load(saCode) : null
  check(sa != null, `${name}: toStandaloneModule produces a module`)
  if (sa) check(norm(sa.validate(bad).errors) === expected, `${name}: toStandaloneModule errors match runtime ${expected}`)

  // bundleStandalone (the rjsf precompiled path)
  const bsCode = Validator.bundleStandalone([schema], { format: 'cjs' })
  const bs = bsCode ? load(bsCode) : null
  check(Array.isArray(bs) && typeof bs[0] === 'function', `${name}: bundleStandalone produces a validator`)
  if (bs) check(norm(bs[0](bad).errors) === expected, `${name}: bundleStandalone errors match runtime ${expected}`)
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
