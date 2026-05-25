'use strict'

// toStandaloneModule must embed user-supplied format functions. The boolean and
// error code paths both reference `_uf_<name>` helpers; the module has to declare
// them or the output throws "_uf_<name> is not defined" on first validate, and
// the error path (validate) has to check the format too so it stays consistent
// with the boolean path (isValid).

const { Validator } = require('..')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }
function load(code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports }

console.log('\ntoStandaloneModule custom (function) formats\n')

const formats = { 'even-len': (s) => typeof s === 'string' && s.length % 2 === 0 }
const schema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'even-len' } },
  required: ['id'],
}

const code = new Validator(schema, { formats }).toStandaloneModule({ format: 'cjs' })
check(code != null, 'custom-format schema produces a standalone module')

let mod
try { mod = load(code) } catch (e) { console.log('        load threw:', e.message) }
check(mod && typeof mod.validate === 'function', 'module loads without ReferenceError')

if (mod) {
  let validIsValid, invalidIsValid, threw = null
  try {
    validIsValid = mod.isValid({ id: 'abcd' })   // length 4, even -> valid
    invalidIsValid = mod.isValid({ id: 'abc' })  // length 3, odd  -> invalid
  } catch (e) { threw = e.message }
  check(threw === null, 'isValid does not throw on the custom format' + (threw ? ` (threw: ${threw})` : ''))
  check(validIsValid === true, 'isValid accepts a value passing the custom format')
  check(invalidIsValid === false, 'isValid rejects a value failing the custom format')

  const okRes = mod.validate({ id: 'abcd' })
  const badRes = mod.validate({ id: 'abc' })
  check(okRes.valid === true, 'validate accepts a value passing the custom format')
  check(badRes.valid === false, 'validate rejects a value failing the custom format (error path consistent with isValid)')
  check(
    badRes.valid === false && badRes.errors.some((e) => e.keyword === 'format'),
    'validate emits a format error for the failing custom format',
  )
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
