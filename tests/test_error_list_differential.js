'use strict'

// The full error list, not just the verdict, must not depend on which engine
// answered. tests/test_error_shape_differential.js holds that on a fixed set of
// shapes; this builds random schemas from the keywords whose errors nest or
// travel through references (anyOf, oneOf, local $ref between two $defs,
// objects and arrays) and compares validate().errors from the default engine
// with the interpreter's, byte for byte as JSON, in both the rich and the
// legacy (`richErrors: false`) shape.
//
// It found four things the fixed set did not: a collapsed error's
// `branchErrors` came out raw, carrying the generator's internal ordering key
// and fields the interpreter never writes; the legacy shape carried `code` and
// `docUrl` whenever the error function answered; branch errors were not put in
// schema order, and a list of one skipped ordering altogether; and a $ref cycle
// that returns to the same value made the generated code and the closure engine
// throw a RangeError where the interpreter answers.

const assert = require('assert')
const { Validator } = require('..')

let seed = Number(process.env.SEED) || 77 // xorshift stays at zero from a zero seed
const rnd = (k) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % k }
const pick = (a) => a[rnd(a.length)]
const NAMES = ['a', 'b', 'c', 'x/y', 'k~1']

const leaf = () => pick([{ type: 'string', minLength: 2 }, { type: 'integer', minimum: 3 }, { enum: [1, 'a', null] }, { const: 2 }, { type: 'boolean' }, { type: 'string', pattern: '^[a-z]+$' }, true, false])
function node (depth) {
  const r = rnd(9)
  if (depth > 2 || r < 3) return leaf()
  if (r < 5) {
    const properties = {}
    for (let i = 0, n = 1 + rnd(3); i < n; i++) properties[pick(NAMES)] = node(depth + 1)
    const o = { type: 'object', properties }
    if (rnd(2)) o.required = [pick(NAMES)]
    if (rnd(3) === 0) o.additionalProperties = node(depth + 1)
    return o
  }
  if (r < 6) return { type: 'array', items: node(depth + 1), maxItems: 3 }
  if (r < 7) return { anyOf: [node(depth + 1), node(depth + 1), ...(rnd(2) ? [node(depth + 1)] : [])] }
  if (r < 8) return { oneOf: [node(depth + 1), node(depth + 1)] }
  return { $ref: '#/$defs/' + pick(['A', 'B']) }
}
function value (depth) {
  const r = rnd(8)
  if (depth > 2 || r < 4) return pick([1, 2, 5, 'a', 'ab', 'Zz', true, null, -1, 2.5])
  if (r < 6) {
    const o = {}
    for (let i = 0, n = rnd(4); i < n; i++) o[pick(NAMES)] = value(depth + 1)
    return o
  }
  return Array.from({ length: rnd(4) }, () => value(depth + 1))
}
const errorsOf = (v, d) => {
  try { return JSON.stringify(v.validate(d).errors || []) } catch (e) { return 'threw ' + e.constructor.name }
}

// A $ref cycle on one value: B reaches A and A reaches B without moving on.
{
  const schema = { type: 'object', additionalProperties: { $ref: '#/$defs/B' }, $defs: { A: { $ref: '#/$defs/B' }, B: { anyOf: [{ const: 2 }, { $ref: '#/$defs/A' }] } } }
  const want = errorsOf(new Validator(schema, { engine: 'interpreter' }), { x: 1 })
  assert.ok(!want.startsWith('threw'), 'the interpreter answers a same-value $ref cycle')
  assert.strictEqual(errorsOf(new Validator(schema), { x: 1 }), want, 'the default engine answers it the same way instead of throwing')
}

// The error function builds its helpers once and keeps the cycle guard's state
// between calls. A custom keyword that validates with the same validator calls
// it while it runs; that call must not share the running one's state.
{
  const schema = { $defs: { N: { type: 'object', properties: { x: { type: 'integer' }, k: { $ref: '#/$defs/N' } }, reentrant: true } }, $ref: '#/$defs/N' }
  const make = (engine) => {
    let v = null
    const keywords = { reentrant: { validate: (s, d) => !(d && d.probe) || (v.validate({ x: 'bad' }).errors.length === 1) } }
    v = new Validator(schema, engine ? { engine, keywords } : { keywords })
    return v
  }
  const doc = { x: 'no', probe: 1, k: { x: 1 } }
  const want = errorsOf(make('interpreter'), doc)
  const v = make()
  assert.strictEqual(errorsOf(v, doc), want, 'a nested call from a custom keyword')
  assert.strictEqual(errorsOf(v, { k: { x: 'z' } }), errorsOf(make('interpreter'), { k: { x: 'z' } }), 'the next call after a nested one')
}

const SCHEMAS = Number(process.env.SCHEMAS || 1500)
let compared = 0, generated = 0
const diffs = []
for (let i = 0; i < SCHEMAS; i++) {
  let schema = node(0)
  if (typeof schema !== 'object') schema = { allOf: [schema] }
  schema.$defs = { A: node(1), B: { anyOf: [node(2), { $ref: '#/$defs/A' }] } }
  const richErrors = i % 2 === 0
  let a, b
  try {
    a = new Validator(schema, { richErrors })
    b = new Validator(schema, { engine: 'interpreter', richErrors })
    a.validate(null)
  } catch { continue }
  if (a.engine() === 'codegen') generated++
  for (let j = 0; j < 8; j++) {
    const d = value(0)
    compared++
    const got = errorsOf(a, d), want = errorsOf(b, d)
    if (got !== want) diffs.push({ schema, d, richErrors, got, want })
  }
}
for (const x of diffs.slice(0, 3)) console.log('DIFF', x.richErrors ? 'rich' : 'legacy', JSON.stringify(x.schema), JSON.stringify(x.d), '\n  default    ', x.got.slice(0, 400), '\n  interpreter', x.want.slice(0, 400))
assert.strictEqual(diffs.length, 0, diffs.length + ' error lists differ between engines')
assert.ok(generated > SCHEMAS / 20, 'only ' + generated + ' schemas used generated code')
console.log(`ok: ${compared} error lists over ${SCHEMAS} schemas are the same on both engines, rich and legacy; ${generated} schemas used generated code`)
