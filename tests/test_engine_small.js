'use strict'

// The small engine (lib/engine-small.js) against the interpreter's walk: the
// same verdict and the same raw error list, every field in order, on every
// group of the official suite in every dialect, with the schema and the
// arguments exactly as the Validator hands them to the interpreter. A schema
// whose options the small engine does not take (custom keywords) returns
// null and is counted, never guessed.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const im = require('../lib/interpreter.js')
const { createSmall } = require('../lib/engine-small.js')
// Every schema-decided group (lib/groups.js), as the full 2.0 entries register them.
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)

const real = im.createInterpreter
let cap = null
im.createInterpreter = (schema, args) => { cap = { schema, args }; return real(schema, args) }
const { Validator } = require('..')

let groups = 0; let docs = 0; let declined = 0; let uncaptured = 0; let refused = 0
function compare (schema, data, label, options) {
  // The Validator builds the interpreter when a call fails and needs errors:
  // isValidObject() answers a failure on its first-call shortcut without it.
  // So null and then each document go to validate() until it is built.
  // Offering null to isValidObject() alone skipped, silently, every schema
  // that accepts null or answers on the shortcut.
  cap = null
  let v
  try { v = new Validator(schema, { engine: 'interpreter', ...options }) } catch { return }
  for (const d of [null, ...data]) {
    try { v.validate(d) } catch {}
    if (cap !== null) break
  }
  if (cap === null) { uncaptured++; return }
  // A schema both engines refuse (a non-array enum or required, as in the
  // suite's draft-03 files) must be refused by both with the same error.
  let walk
  try { walk = real(cap.schema, { ...cap.args, tier: Infinity }) } catch (e) {
    assert.throws(() => createSmall(cap.schema, cap.args), { name: e.name, message: e.message }, label + ': both refuse the schema')
    refused++; return
  }
  const small = createSmall(cap.schema, cap.args)
  if (small === null) { declined++; return }
  groups++
  for (const d of data) {
    docs++
    const where = `${label}: ${JSON.stringify(d).slice(0, 100)}`
    let want; try { want = walk.validate(d) } catch (e) { want = e }
    if (want instanceof Error) { assert.throws(() => small.validate(d), where + ': both throw'); continue }
    assert.strictEqual(JSON.stringify(small.validate(d)), JSON.stringify(want), where)
    assert.strictEqual(small.isValid(d), want.valid, where + ': isValid')
  }
}

const SUITE = path.join(__dirname, 'suite/tests')
for (const dialect of fs.readdirSync(SUITE)) {
  for (const sub of ['', 'optional', 'optional/format']) {
    const dir = path.join(SUITE, dialect, sub)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        if (JSON.stringify(g.schema).includes('localhost:1234')) continue
        const label = `${dialect}/${sub ? sub + '/' : ''}${f}: ${g.description}`
        compare(g.schema, g.tests.map((t) => t.data), label, {})
        compare(g.schema, g.tests.map((t) => t.data), label + ' (assertFormat: false)', { assertFormat: false })
      }
    }
  }
}

// Schemas registered beside the root, the caller's formats, and values JSON
// cannot hold.
const reg = { schemas: [{ $id: 'https://example.com/item', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }] }
compare({ type: 'array', items: { $ref: 'https://example.com/item' } }, [[{ n: 1 }], [{ n: 'x' }, {}], 'no'], 'registered schema', reg)
compare({ type: 'string', format: 'even' }, ['ab', 'abc', 1], 'caller format', { formats: { even: (s) => s.length % 2 === 0 } })
compare({ type: 'string', format: 'hasOwnProperty' }, ['x'], 'a format named like an Object member', {})
const hidden = Object.defineProperty({ a: 1 }, 'b', { value: 'x', enumerable: false })
compare({ properties: { a: { type: 'string' }, b: { type: 'integer' } }, additionalProperties: false }, [hidden, Object.create({ a: 1 }), { a: undefined }, { __proto__: null, c: 1 }, [undefined], NaN, Infinity, -0], 'values JSON cannot hold', {})
compare({ required: ['a', 'toString'], properties: { a: {} } }, [{ a: undefined }, {}, { toString: 1 }], 'required and undefined', {})
const typeDocs = [1, 'x', {}, [], null, true, 1.5]
for (const t of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
  compare({ type: t }, typeDocs, `a type named like an Object member (${t})`, {})
  compare({ type: ['string', t] }, typeDocs, `a type list holding an Object member's name (${t})`, {})
}

assert.ok(groups > 4000 && docs > 20000, `${groups} groups, ${docs} documents`)
console.log(`test_engine_small: ok, ${groups} schema builds, ${docs} documents as the interpreter's walk; ${declined} declined, ${refused} refused by both, ${uncaptured} where no document fails`)
