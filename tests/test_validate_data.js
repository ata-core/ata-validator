'use strict'

// validate() resolves a typed `data` on success, matching the
// ValidationResult<T> contract in index.d.ts (and tests/test_typed_validator.ts,
// tests/test_infer.ts assert that type). On failure there is no data.

const { Validator } = require('..')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }

console.log('\nvalidate() returns typed data on success\n')

const schema = {
  type: 'object',
  properties: { id: { type: 'number' }, name: { type: 'string' } },
  required: ['id'],
}

const v = new Validator(schema)

const okInput = { id: 1, name: 'Mert' }
const ok = v.validate(okInput)
check(ok.valid === true, 'valid input -> valid:true')
check(ok.data === okInput, 'valid input -> data is the validated value')
check(ok.data && ok.data.id === 1, 'valid input -> data.id readable')

const bad = v.validate({ name: 'x' })
check(bad.valid === false, 'invalid input -> valid:false')
check(bad.data === undefined, 'invalid input -> no data')
check(Array.isArray(bad.errors) && bad.errors.length > 0, 'invalid input -> errors present')

// Coercion: data should reflect the coerced value, not the raw input.
const vc = new Validator(
  { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
  { coerceTypes: true },
)
const coerced = vc.validate({ n: '42' })
check(coerced.valid === true, 'coercible input -> valid:true')
check(coerced.valid && coerced.data.n === 42, 'coercion -> data carries the coerced number')

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
