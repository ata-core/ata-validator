'use strict'

// NaN and Infinity are not JSON, but isValidObject() takes JavaScript values,
// so they can arrive. Every engine rejects them for `number` except the
// tier-0 validator that answers a fresh Validator's first calls, which
// checked typeof alone. A validator must not change its mind about the same
// value between its first call and its third, so this file asks fresh
// instances first-call questions and compares them with validate().

const { Validator } = require('..')

let failed = 0
const check = (name, cond) => {
  if (!cond) { console.error('FAIL ' + name); failed = 1 }
}

const cases = [
  [{ type: 'number' }, NaN],
  [{ type: 'number' }, Infinity],
  [{ type: 'number' }, -Infinity],
  [{ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }, { n: NaN }],
  [{ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }, { n: Infinity }],
  [{ type: 'array', items: { type: 'number' } }, [1, NaN]],
  [{ type: 'integer' }, NaN],
  [{ type: 'object', properties: { n: { type: 'number', minimum: 0 } } }, { n: NaN }],
]

for (const [schema, data] of cases) {
  const label = JSON.stringify(schema) + ' <- ' + String(data && data.n !== undefined ? 'nested ' + data.n : data)
  // first-call verdict from a fresh instance (tier 0 answers this one)
  const cold = new Validator(schema).isValidObject(data)
  // reference verdict from the full walk on another fresh instance
  const ref = new Validator(schema).validate(data).valid
  check('cold verdict matches validate for ' + label, cold === ref)
  check('non-finite numbers are rejected for ' + label, ref === false)
  // warmed verdict must agree with the cold one
  const w = new Validator(schema)
  w.isValidObject(data); w.isValidObject(data); w.isValidObject(data)
  check('warm verdict stays the same for ' + label, w.isValidObject(data) === cold)
}

if (failed) process.exit(1)
console.log('nan verdict: engines agree on non-finite numbers, cold and warm')
