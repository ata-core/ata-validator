'use strict'

// draft-04 spelled the exclusive bounds as booleans modifying `minimum` and
// `maximum`. The engines read the numeric form every later dialect uses, and
// the codegen path compared the value against the boolean directly, so `true`
// became 1: `{ maximum: 5, exclusiveMaximum: true }` rejected 1, and
// `{ minimum: 3, exclusiveMinimum: true }` accepted 3. One was a wrong
// rejection, the other a wrong acceptance, and the interpreter disagreed with
// both because it ignores a non-numeric bound.
//
// Schemas in this shape are still in circulation, OpenAPI 2.0 documents among
// them. Normalization rewrites the pair so every engine reads one keyword.

// Run twice, once with code generation blocked, so the compiled and the
// interpreted engine are both held to the list below. Reaching into
// createInterpreter directly would skip the normalization a Validator does,
// which is the very step under test.
const { Validator } = require('..')

let failed = 0
const check = (name, cond) => {
  if (!cond) { console.error('FAIL ' + name); failed = 1 }
}

const D4 = 'http://json-schema.org/draft-04/schema#'
const clone = (s) => JSON.parse(JSON.stringify(s))

const cases = [
  ['exclusiveMaximum true, below the bound', { $schema: D4, maximum: 5, exclusiveMaximum: true }, 1, true],
  ['exclusiveMaximum true, on the bound', { $schema: D4, maximum: 5, exclusiveMaximum: true }, 5, false],
  ['exclusiveMaximum true, above the bound', { $schema: D4, maximum: 5, exclusiveMaximum: true }, 6, false],
  ['exclusiveMinimum true, on the bound', { $schema: D4, minimum: 3, exclusiveMinimum: true }, 3, false],
  ['exclusiveMinimum true, above the bound', { $schema: D4, minimum: 3, exclusiveMinimum: true }, 4, true],
  ['exclusiveMinimum true, below the bound', { $schema: D4, minimum: 3, exclusiveMinimum: true }, 2, false],
  ['exclusiveMinimum false keeps the inclusive bound', { $schema: D4, minimum: 3, exclusiveMinimum: false }, 3, true],
  ['exclusiveMaximum false keeps the inclusive bound', { $schema: D4, maximum: 5, exclusiveMaximum: false }, 5, true],
  ['a boolean with no bound beside it says nothing', { $schema: D4, exclusiveMinimum: true }, 0, true],
  ['nested in properties', { $schema: D4, type: 'object', properties: { n: { minimum: 3, exclusiveMinimum: true } } }, { n: 3 }, false],
  ['the numeric form is untouched', { exclusiveMinimum: 3 }, 3, false],
  ['the numeric form still accepts above', { exclusiveMinimum: 3 }, 4, true],
]

for (const [name, schema, data, want] of cases) {
  const got = new Validator(clone(schema)).isValidObject(data)
  check(name, got === want)
  // validate() walks a different path than the verdict shortcut, and a
  // disagreement between them is how the original bug stayed invisible.
  check(name + ' (validate agrees)', new Validator(clone(schema)).validate(data).valid === want)
}

// The caller's schema is never rewritten in place.
{
  const schema = { $schema: D4, minimum: 3, exclusiveMinimum: true }
  const before = JSON.stringify(schema)
  new Validator(schema).isValidObject(4)
  check('the caller keeps its schema', JSON.stringify(schema) === before)
}

if (failed) process.exit(1)
console.log('exclusive bounds: the draft-04 boolean form reads the same on every engine')
