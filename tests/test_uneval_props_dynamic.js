'use strict'

// unevaluatedProperties whose evaluated set depends on which branches pass is
// built at run time in the combined function (genUnevaluatedDynamicC and
// emitAnnot in lib/js-compiler.js). Getting that set wrong is a silent accept
// when a key counts as evaluated that should not. This holds the generated
// engine to the interpreter, verdict and error list, on random schemas mixing
// the applicators that contribute (allOf, anyOf, oneOf, if/then/else,
// dependentSchemas, $ref) with properties, patternProperties and nested
// unevaluatedProperties, read past the point where validate() is the combined
// function itself. It counts the schemas whose combined function compiled, so
// it cannot pass by declining them.

const assert = require('node:assert')
const { Validator } = require('..')
const jc = require('../lib/js-compiler')

let seed = Number(process.env.SEED) || 2026
const rnd = (k) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % k }
const pick = (a) => a[rnd(a.length)]
const KEYS = ['a', 'b', 'c', 'x1', 'x2', 'k/1']
const leaf = () => pick([true, { type: 'string' }, { type: 'integer' }, { const: 1 }, { minimum: 2 }, false])

function props () {
  const o = {}
  for (let i = 0, n = 1 + rnd(2); i < n; i++) o[pick(KEYS)] = leaf()
  return o
}
function branch (depth) {
  const s = {}
  const r = rnd(8)
  if (r < 4) s.properties = props()
  if (r === 4) s.patternProperties = { '^x': leaf() }
  if (r === 5) s.required = [pick(KEYS)]
  if (rnd(3) === 0) s.required = [pick(KEYS)]
  if (depth < 2 && rnd(4) === 0) s.anyOf = [branch(depth + 1), branch(depth + 1)]
  if (depth < 2 && rnd(5) === 0) s.unevaluatedProperties = rnd(2) ? false : leaf()
  if (depth < 2 && rnd(6) === 0) s.$ref = '#/$defs/D'
  return s
}
function schema () {
  const s = { $defs: { D: { properties: { [pick(KEYS)]: leaf() } } } }
  if (rnd(2)) s.properties = props()
  if (rnd(4) === 0) s.patternProperties = { '^x': leaf() }
  const r = rnd(6)
  if (r === 0) s.allOf = [branch(0), branch(0)]
  if (r === 1) s.anyOf = [branch(0), branch(0)]
  if (r === 2) s.oneOf = [branch(0), branch(0)]
  if (r === 3) { s.if = branch(1); s.then = branch(1); if (rnd(2)) s.else = branch(1) }
  if (r === 4) s.dependentSchemas = { [pick(KEYS)]: branch(1) }
  if (r === 5) s.allOf = [{ $ref: '#/$defs/D' }, branch(0)]
  s.unevaluatedProperties = rnd(4) === 0 ? { type: 'integer' } : false
  return s
}
function doc () {
  const o = {}
  for (const k of KEYS) if (rnd(2)) o[k] = pick(['s', 1, 3, 2.5, true, null, 'x'])
  return o
}

let compiled = 0, compared = 0, rejected = 0
for (let i = 0; i < 1500; i++) {
  const s = schema()
  let v, ref
  try {
    v = new Validator(s, { richErrors: i % 2 === 0 })
    ref = new Validator(s, { richErrors: i % 2 === 0, engine: 'interpreter' })
    v.validate({})
  } catch { continue }
  if (jc.compileToJSCombined(v._schemaObj, { valid: true }, null, null, { runtimeShape: true })) compiled++
  const docs = []
  for (let k = 0; k < 6; k++) docs.push(doc())
  // Past the reads at which validate() switches to the one-pass function.
  for (let r = 0; r < 4; r++) for (const d of docs) void v.validate(d).errors
  for (const d of docs) {
    const want = ref.validate(d)
    const got = v.validate(d)
    assert.strictEqual(got.valid, want.valid, `verdict differs for ${JSON.stringify(s)} on ${JSON.stringify(d)}`)
    assert.strictEqual(JSON.stringify(got.errors), JSON.stringify(want.errors), `errors differ for ${JSON.stringify(s)} on ${JSON.stringify(d)}`)
    compared++
    if (!want.valid) rejected++
  }
}
assert.ok(compiled >= 300, `too few schemas compiled the combined function: ${compiled}`)
assert.ok(rejected >= 2000, `too few rejections compared: ${rejected}`)
console.log(`ok: runtime unevaluatedProperties agrees with the interpreter (${compiled} schemas compiled, ${compared} documents, ${rejected} rejected)`)
