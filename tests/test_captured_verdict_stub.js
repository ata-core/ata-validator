'use strict'

// A caller can hold isValidObject before its first call: `const check =
// v.isValidObject`, a bound copy, a callback. That reference is the lazy stub,
// not the bound method, and it used to redo the first call's work, classifying
// the schema, on every call: about 200 ns where the check costs 20. Counts the
// work, not the time: after the first call the stub must hand straight on.

const assert = require('node:assert')
const { Validator } = require('..')

for (const schema of [
  { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] },
  { type: 'array', prefixItems: [{ type: 'string' }], items: false },
  { type: 'string', minLength: 2 },
]) {
  const v = new Validator(schema)
  let probes = 0
  const real = v._needsPreprocess.bind(v)
  v._needsPreprocess = () => { probes++; return real() }
  const check = v.isValidObject
  const bound = v.isValidObject.bind(v)
  const docs = [{ a: 1 }, { a: 'x' }, ['s'], ['s', 1], 'ab', 'a', null]
  for (let i = 0; i < 50; i++) for (const d of docs) {
    assert.strictEqual(check(d), v.validate(d).valid)
    assert.strictEqual(bound(d), v.validate(d).valid)
  }
  // Each of the two references does the first-call work once.
  assert.ok(probes <= 2, `the captured stub redid its first-call work ${probes} times`)
}
console.log('ok: a captured isValidObject hands straight to the bound method after its first call')
