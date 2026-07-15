'use strict'

// Every standalone emit path must embed user-supplied format functions. The
// boolean and error bodies both reference `_uf_<name>` helpers; the output has
// to declare them or it throws "_uf_<name> is not defined" on first validate,
// and the error path must check the format too so validate() stays consistent
// with the boolean isValid().

const { Validator } = require('..')
const aot = require('../lib/aot')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }
function load(code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports }

const formats = { 'even-len': (s) => typeof s === 'string' && s.length % 2 === 0 }
const schema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'even-len' } },
  required: ['id'],
}

// Run the shared contract against one validate(data) -> { valid, errors } fn.
function checkValidator(label, validate) {
  let threw = null, okRes, badRes
  try { okRes = validate({ id: 'abcd' }); badRes = validate({ id: 'abc' }) }
  catch (e) { threw = e.message }
  check(threw === null, `${label}: does not throw on the custom format` + (threw ? ` (threw: ${threw})` : ''))
  if (threw) return
  check(okRes.valid === true, `${label}: accepts a value passing the custom format`)
  check(badRes.valid === false, `${label}: rejects a value failing the custom format`)
  check(
    badRes.valid === false && (badRes.errors || []).some((e) => e.keyword === 'format'),
    `${label}: emits a format error for the failing value`,
  )
}

console.log('\nstandalone emit paths embed custom (function) formats\n')

// 1. toStandaloneModule
{
  const code = aot.toStandaloneModule(new Validator(schema, { formats }), { format: 'cjs' })
  check(code != null, 'toStandaloneModule: produces a module')
  const mod = code ? load(code) : null
  if (mod) checkValidator('toStandaloneModule', mod.validate)
}

// 2. bundleStandalone (the path the rjsf precompiled adapter uses)
{
  const code = Validator.bundleStandalone([schema], { format: 'cjs', formats })
  check(code != null, 'bundleStandalone: produces a module')
  const arr = code ? load(code) : null
  if (arr) checkValidator('bundleStandalone', arr[0])
}

// 3. bundleCompact
{
  const code = Validator.bundleCompact([schema], { format: 'cjs', formats })
  check(code != null, 'bundleCompact: produces a module')
  const arr = code ? load(code) : null
  if (arr) checkValidator('bundleCompact', arr[0])
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
