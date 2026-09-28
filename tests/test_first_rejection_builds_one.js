'use strict'

// A first rejection needs one error-producing generator, not two. The error
// and the combined generators used to be built together on the first
// rejection, which cost a millisecond of V8 compiling one nobody called. This
// counts how often each is built, checks the errors against the interpreted
// engine on every official suite group, and checks that a warm validator
// still gets both, so the split cannot pass by quietly never building one.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const compiler = require('../lib/js-compiler')

const counts = { combined: 0, errors: 0, combinedDeclined: 0 }
const realCombined = compiler.compileToJSCombined
const realErrors = compiler.compileToJSCodegenWithErrors
compiler.compileToJSCombined = function () { counts.combined++; const f = realCombined.apply(this, arguments); if (!f) counts.combinedDeclined++; return f }
compiler.compileToJSCodegenWithErrors = function () { counts.errors++; return realErrors.apply(this, arguments) }

const { Validator } = require('..')

const shape = (errs) => JSON.stringify(errs.map((e) => [e.keyword, e.instancePath, e.schemaPath]).sort())

// The order schema from the realistic benchmark, with a body that fails.
const order = {
  type: 'object',
  required: ['id', 'items'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    items: { type: 'array', minItems: 1, items: { type: 'object', required: ['sku'], properties: { sku: { type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' }, quantity: { type: 'integer', minimum: 1 } } } },
  },
}
const bad = { id: 'nope', items: [{ sku: 'abc-1', quantity: 0 }] }

counts.combined = 0; counts.errors = 0
const v = new Validator(order)
const r = v.validate(bad)
assert.strictEqual(r.valid, false)
assert.ok(r.errors.length >= 3, 'the rejection names every failing keyword')
assert.strictEqual(counts.combined + counts.errors, 1, `first rejection built ${counts.combined} combined and ${counts.errors} error generators, expected one`)
assert.strictEqual(shape(r.errors), shape(new Validator(order, { engine: 'interpreter' }).validate(bad).errors))

// Warm: past the tier both generators exist, and the answer does not change.
for (let i = 0; i < 80; i++) void v.validate(bad).errors
const warm = v.validate(bad)
assert.strictEqual(shape(warm.errors), shape(r.errors))

// Every suite group: the first rejection builds one generator, or two only
// when the combined one declined and the error generator had to stand in; and
// its errors agree with the same rejection read once warm.
const dir = path.join(__dirname, 'suite/tests/draft2020-12')
let groups = 0, rejections = 0, bad2 = 0, generated = 0
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    const t = g.tests.find((x) => !x.valid)
    if (!t) continue
    let val
    try { val = new Validator(g.schema) } catch { continue }
    counts.combined = 0; counts.errors = 0; counts.combinedDeclined = 0
    const first = val.validate(t.data)
    if (first.valid) continue
    const firstShape = shape(first.errors)
    const built = counts.combined + counts.errors - counts.combinedDeclined
    rejections++
    if (built === 1) generated++
    if (built > 1 && bad2++ < 5) console.error(`${f}: ${g.description}: first rejection built ${built} generators`)
    for (let i = 0; i < 80; i++) void val.validate(t.data).errors
    if (shape(val.validate(t.data).errors) !== firstShape && bad2++ < 5) console.error(`${f}: ${g.description}: errors changed once warm`)
    groups++
  }
}
assert.strictEqual(bad2, 0)
// Many suite schemas are answered by the interpreted engine and build no
// generator at all; the floor is on the ones that went through codegen.
assert.ok(generated > 150, `only ${generated} of ${rejections} first rejections built a generator: too few to mean anything`)
console.log(`ok: first rejection builds one generator (${generated} of ${rejections} suite groups went through codegen), errors unchanged warm`)
