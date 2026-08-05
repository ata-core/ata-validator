'use strict'

// propertyDependencies, a JSON Schema v1 proposal.
//
// https://github.com/json-schema-org/json-schema-spec/blob/main/specs/proposals/propertyDependencies.md
//
// Selects a subschema by the value of a property rather than by its presence,
// which is what dependentSchemas does. The proposal defines it as equivalent to
//
//   { "if":   { "properties": { p: { "const": v } }, "required": [p] },
//     "then": <schema> }
//
// so that equivalence is what this file checks, case by case, rather than a
// hand-written expectation of what the keyword ought to do. It also runs the
// official test files for the proposal.
//
// The keyword lives in the interpreted engine only. Both JS compiler paths
// decline a schema that uses it, because emitting nothing for a keyword they do
// not know would make the constraint vacuous.

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { Validator } = require('..')
const { compileToJSCodegen, compileToJS } = require('../lib/js-compiler')

let passed = 0
let failed = 0

function check(name, actual, expected) {
  if (actual === expected) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}: expected ${expected}, got ${actual}`)
  }
}

console.log('\npropertyDependencies\n')

// Equivalence with the if/then form the proposal specifies.
const BRANCH = { required: ['customerId'] }
const propDeps = new Validator({ propertyDependencies: { type: { customer: BRANCH } } })
const ifThen = new Validator({
  if: { properties: { type: { const: 'customer' } }, required: ['type'] },
  then: BRANCH,
})

const instances = [
  { type: 'customer', customerId: 1 },
  { type: 'customer' },
  { type: 'employee' },
  { type: '' },
  { type: null },
  { type: 42 },
  { type: ['customer'] },
  {},
  'a string',
  42,
  null,
  [],
]

for (const instance of instances) {
  const label = `equivalent to if/then for ${JSON.stringify(instance)}`
  check(label, propDeps.validate(instance).valid, ifThen.validate(instance).valid)
}

// Several property names apply independently, and a value matches at most one
// branch since a property holds a single value.
const multi = new Validator({
  propertyDependencies: {
    type: { customer: { required: ['customerId'] }, employee: { required: ['employeeId'] } },
    tier: { gold: { required: ['discount'] } },
  },
})
check('two names, both satisfied', multi.validate({ type: 'customer', customerId: 1, tier: 'gold', discount: 5 }).valid, true)
check('two names, second unsatisfied', multi.validate({ type: 'customer', customerId: 1, tier: 'gold' }).valid, false)
check('second branch of the same name', multi.validate({ type: 'employee' }).valid, false)
check('no name present', multi.validate({}).valid, true)

// It is an applicator, so a matched branch contributes annotations.
const withUnevaluated = {
  type: 'object',
  properties: { type: { type: 'string' } },
  propertyDependencies: { type: { customer: { properties: { customerId: { type: 'integer' } } } } },
  unevaluatedProperties: false,
}
const uneval = new Validator(withUnevaluated)
check('matched branch marks its properties evaluated', uneval.validate({ type: 'customer', customerId: 1 }).valid, true)
check('unmatched branch does not', uneval.validate({ type: 'other', customerId: 1 }).valid, false)
check('genuinely unknown property still rejected', uneval.validate({ type: 'customer', customerId: 1, other: 1 }).valid, false)

// Malformed keyword values are ignored rather than throwing.
check('non-object keyword value', new Validator({ propertyDependencies: 'nonsense' }).validate({ a: 1 }).valid, true)
check('non-object branch map', new Validator({ propertyDependencies: { a: 'nonsense' } }).validate({ a: 'x' }).valid, true)

// Neither JS path may claim a schema using the keyword.
assert.strictEqual(
  compileToJSCodegen({ propertyDependencies: { a: { b: { required: ['c'] } } } }, new Map(), null),
  null,
  'codegen must decline propertyDependencies rather than ignore it',
)
assert.strictEqual(
  compileToJS({ propertyDependencies: { a: { b: { required: ['c'] } } } }, null, new Map()),
  null,
  'the closure path must decline propertyDependencies rather than ignore it',
)
passed += 2
console.log('  PASS  both JS compiler paths decline the keyword')

// Official test files for the proposal.
const SUITE = path.join(__dirname, 'suite/tests/v1/proposals/propertyDependencies')

// $dynamicRef resolution through a $ref into a sibling resource is a gap the
// interpreted engine has independently of this keyword: the if/then form of the
// same schema fails identically. Listed so a change in either direction shows.
const KNOWN = new Set([
  'dynamicRef.json :: multiple dynamic paths to the $dynamicRef keyword :: number list with number values',
  'dynamicRef.json :: multiple dynamic paths to the $dynamicRef keyword :: string list with string values',
])

if (fs.existsSync(SUITE)) {
  let suitePass = 0
  let known = 0
  const regressions = []

  for (const file of fs.readdirSync(SUITE).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(SUITE, file), 'utf8'))) {
      let validator
      try {
        validator = new Validator(group.schema)
      } catch (e) {
        regressions.push(`${file} :: ${group.description} :: schema failed to compile: ${e.message}`)
        continue
      }
      for (const test of group.tests) {
        const key = `${file} :: ${group.description} :: ${test.description}`
        let ok = false
        try {
          ok = validator.validate(test.data).valid === test.valid
        } catch (e) {
          regressions.push(`${key} :: threw ${e.message}`)
          continue
        }
        if (ok) suitePass++
        else if (KNOWN.has(key)) known++
        else regressions.push(key)
      }
    }
  }

  console.log(`\n  official suite: ${suitePass} passed, ${known} known failures, ${regressions.length} regressions`)
  for (const r of regressions) console.log(`    ${r}`)
  if (regressions.length > 0) failed += regressions.length
  else passed++
} else {
  console.log('\n  official suite files not present, skipping')
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
