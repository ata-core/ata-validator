'use strict'

// validateAndParse(jsonString | Buffer) parses then validates, returning
// { valid, value, errors }. Implemented in pure JS (JSON.parse + validate) so
// it works with or without the native addon and in the browser.

const { Validator } = require('..')
const assert = require('assert')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }

const schema = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name'] }

console.log('\nvalidateAndParse\n')

// valid JSON + valid data
{
  const v = new Validator(schema)
  const r = v.validateAndParse('{"name":"Mert","age":26}')
  check(r.valid === true, 'valid data -> valid:true')
  check(r.value && r.value.name === 'Mert' && r.value.age === 26, 'valid data -> value parsed')
  check(Array.isArray(r.errors) && r.errors.length === 0, 'valid data -> no errors')
}

// valid JSON + invalid data
{
  const v = new Validator(schema)
  const r = v.validateAndParse('{"age":26}')
  check(r.valid === false, 'missing required -> valid:false')
  check(r.value && r.value.age === 26, 'invalid data -> value still parsed')
  check(r.errors.length > 0, 'invalid data -> errors present')
}

// invalid JSON does not throw
{
  const v = new Validator(schema)
  let threw = false, r
  try { r = v.validateAndParse('{ not json') } catch { threw = true }
  check(!threw, 'malformed JSON does not throw')
  check(r && r.valid === false, 'malformed JSON -> valid:false')
  check(r && r.errors.length > 0, 'malformed JSON -> errors present')
}

// Buffer input
{
  const v = new Validator(schema)
  const r = v.validateAndParse(Buffer.from('{"name":"Ada"}'))
  check(r.valid === true && r.value.name === 'Ada', 'Buffer input parsed and validated')
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
