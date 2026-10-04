'use strict'

// The hybrid validate(), validateJSON's hybrid, the extended verdict and the
// generated validate() a validator takes past its first calls are all the
// boolean program with its returns rewritten (replaceTopLevel). The rewrite
// scans generated text, and text inside string literals is not code: a
// property called `function` made it skip every return after it, and
// validateJSON answered a bare `false` instead of a rejection (1.41.0 and
// before). This puts the words and characters that scan cares about into
// property names, enum and const values and patterns, and checks every entry
// point past its warm-up against the interpreter, result by result. It counts
// the comparisons that reached the generated paths.

const assert = require('node:assert')
const { Validator } = require('..')

const WORDS = ['function', 'functions', '=>{', 'return false', 'return true', 'return falsey', '{', '}', '"', "'", '`', '\\', '\\"', 'a"b', "it's", '${x}', '}{', 'function(){', 'x=>{return false}']
const json = (x) => JSON.stringify(x)
let compared = 0, generated = 0

function check (schema, docs) {
  const v = new Validator(schema)
  const ref = new Validator(schema, { engine: 'interpreter' })
  // Past the tier at which validate() becomes the generated function, and the
  // hybrids are built.
  for (let i = 0; i < 70; i++) for (const d of docs) { v.validate(d); v.validateJSON(json(d)) }
  if (v.engine() === 'codegen') generated++
  for (const d of docs) {
    const want = ref.validate(d)
    const got = v.validate(d)
    assert.strictEqual(typeof got, 'object', `validate returned ${typeof got} for ${json(schema)} on ${json(d)}`)
    assert.strictEqual(json(got), json(want), `validate: ${json(schema)} on ${json(d)}`)
    const gotJ = v.validateJSON(json(d))
    assert.strictEqual(typeof gotJ, 'object', `validateJSON returned ${typeof gotJ} for ${json(schema)} on ${json(d)}`)
    assert.strictEqual(gotJ.valid, want.valid, `validateJSON: ${json(schema)} on ${json(d)}`)
    assert.strictEqual(json(gotJ.errors.map((e) => e.message)), json(want.errors.map((e) => e.message)), `validateJSON errors: ${json(schema)} on ${json(d)}`)
    assert.strictEqual(v.isValidObject(d), want.valid)
    assert.strictEqual(v.isValidJSON(json(d)), want.valid)
    compared++
  }
}

for (const w of WORDS) {
  // A property named with the word, guarding a nested object, then a check
  // after it that the rewrite must still reach.
  check({ type: 'object', properties: { [w]: { type: 'object', properties: { a: { type: 'string' } } }, last: { type: 'integer' } } },
    [{ [w]: { a: 1 } }, { [w]: { a: 'x' } }, { last: 'x' }, { [w]: {}, last: 2 }, {}])
  // The word as a required name and in additionalProperties.
  check({ type: 'object', required: [w], properties: { [w]: { type: 'string' } }, additionalProperties: false },
    [{}, { [w]: 'x' }, { [w]: 1 }, { [w]: 'x', extra: 1 }])
  // The word as an enum and const value, then a later check.
  check({ type: 'object', properties: { e: { enum: [w, 'plain'] }, c: { const: w }, n: { type: 'number' } } },
    [{ e: w, c: w, n: 1 }, { e: 'other', c: w }, { c: 'other' }, { n: 'x' }, { e: w, c: w, n: 'x' }])
  // The word in an array of objects, with a check after the loop.
  check({ type: 'array', items: { type: 'object', properties: { [w]: { type: 'boolean' } } }, maxItems: 2 },
    [[{ [w]: true }], [{ [w]: 1 }], [{}, {}, {}], [{ [w]: false }, { [w]: 'x' }]])
}
// Patterns with braces and quotes.
check({ type: 'object', properties: { p: { type: 'string', pattern: '^[{}"\']+$' }, q: { type: 'integer' } } },
  [{ p: '{}' }, { p: 'a' }, { q: 'x' }, { p: '""', q: 1 }])

assert.ok(compared >= 300, `too few comparisons: ${compared}`)
assert.ok(generated >= 70, `too few schemas reached the generated paths: ${generated}`)
console.log(`ok: rewritten returns agree with the interpreter on every entry point (${compared} documents, ${generated} generated schemas)`)
