'use strict'

// The `formats` option wins over the built-in check of the same name, the way
// the interpreted engine and tier 0 read it: the caller's function first, then
// the table. A format named '' or like an Object.prototype member is looked up
// as an own key. The generators consulted the built-in table first and through
// the prototype chain, so `formats: { email: () => false }` was ignored on
// generated code, `format: ''` skipped its function, and `format:
// 'hasOwnProperty'` threw while compiling. Every path that checks a format is
// held to the interpreter here: the three generators, the router's tiers, tier
// 0, and standalone modules with the function embedded or injected.

const assert = require('assert')
const { Validator } = require('..')
const { compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined } = require('../lib/js-compiler')
const { buildTier0Plan, tier0Validate } = require('../lib/tier0')
const { toStandaloneModule } = require('../build')

const VALID = { valid: true, errors: [] }
function load (src) { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); return m.exports }

const cases = [
  // format, the caller's function or null, value, expected verdict
  ['', (s) => s === 'empty', 'x', false],
  ['', (s) => s === 'empty', 'empty', true],
  ['email', () => false, 'a@b.co', false],
  ['uuid', () => false, '123e4567-e89b-12d3-a456-426614174000', false],
  ['date', (s) => s === 'never', 'never', true],
  ['date', (s) => s === 'never', '2020-01-01', false],
  ['ipv4', (s) => s.length === 3, '1.1', true],
  ['constructor', () => false, 'x', false],
  ['toString', () => false, 'x', false],
  ['hasOwnProperty', () => false, 'x', false],
  ['__proto__', () => false, 'x', false],
  ['valueOf', (s) => s === 'v', 'v', true],
  ['constructor', null, 'x', true],
  ['email', null, 'a@b.co', true],
  ['email', null, 'nope', false],
]

let compared = 0
for (const [format, fn, value, expected] of cases) {
  const formats = fn ? { [format]: fn } : {}
  const label = `format ${JSON.stringify(format)} ${fn ? 'with' : 'without'} a function on ${JSON.stringify(value)}`
  const schema = { type: 'string', format }
  const objSchema = { type: 'object', properties: { x: schema }, required: ['x'] }
  const obj = { x: value }
  const text = JSON.stringify(value)

  assert.strictEqual(new Validator(schema, { formats, engine: 'interpreter' }).validate(value).valid, expected, `${label}: interpreter`)
  assert.strictEqual(new Validator(objSchema, { formats, engine: 'interpreter' }).validate(obj).valid, expected, `${label}: interpreter, object form`)

  const v = new Validator(schema, { formats })
  assert.strictEqual(v.validate(value).valid, expected, `${label}: validate()`)
  assert.strictEqual(v.isValidObject(value), expected, `${label}: isValidObject()`)
  assert.strictEqual(v.validateJSON(text).valid, expected, `${label}: validateJSON()`)
  assert.strictEqual(v.isValidJSON(text), expected, `${label}: isValidJSON()`)
  for (let i = 0; i < 70; i++) { v.validate(value); v.validateJSON(text) }
  assert.strictEqual(v.validate(value).valid, expected, `${label}: validate() warm`)
  assert.strictEqual(v.validateJSON(text).valid, expected, `${label}: validateJSON() warm`)
  assert.strictEqual(v.engine(), 'codegen', `${label}: the router must pick codegen`)

  const bool = compileToJSCodegen(schema, null, formats)
  assert.ok(typeof bool === 'function', `${label}: compileToJSCodegen must compile`)
  assert.strictEqual(bool(value), expected, `${label}: compileToJSCodegen`)
  const err = compileToJSCodegenWithErrors(schema, null, formats)
  assert.ok(typeof err === 'function', `${label}: compileToJSCodegenWithErrors must compile`)
  assert.strictEqual(err(value, true).valid, expected, `${label}: compileToJSCodegenWithErrors`)
  const comb = compileToJSCombined(schema, VALID, null, formats)
  if (comb) assert.strictEqual(comb(value).valid, expected, `${label}: compileToJSCombined`)

  const vo = new Validator(objSchema, { formats })
  assert.strictEqual(vo.validate(obj).valid, expected, `${label}: object form`)
  assert.strictEqual(vo.isValidObject(obj), expected, `${label}: object form isValidObject()`)
  assert.strictEqual(tier0Validate(buildTier0Plan(objSchema, formats), obj), expected, `${label}: tier 0`)

  const embedded = load(toStandaloneModule(objSchema, { format: 'cjs', formats }))
  assert.strictEqual(embedded.isValid(obj), expected, `${label}: standalone isValid`)
  assert.strictEqual(embedded.validate(obj).valid, expected, `${label}: standalone validate`)
  if (fn) {
    const injected = load(toStandaloneModule(objSchema, { format: 'cjs', formats, formatMode: 'inject' }))
    injected.setFormats(formats)
    assert.strictEqual(injected.isValid(obj), expected, `${label}: injected isValid`)
    assert.strictEqual(injected.validate(obj).valid, expected, `${label}: injected validate`)
  }
  compared++
}

// With a length bound beside it the leaf takes the generator's one-line
// string path, which tested `schema.format` for truth and so wrote no check
// at all for a format named ''.
{
  const formats = { '': (s) => s === 'empty' }
  const schema = { type: 'object', properties: { x: { type: 'string', format: '', minLength: 1, maxLength: 20 } } }
  for (const [x, expected] of [['empty', true], ['other', false]]) {
    const ref = new Validator(schema, { formats, engine: 'interpreter' }).validate({ x }).valid
    assert.strictEqual(ref, expected, `bounded '' format on ${x}: interpreter`)
    const v = new Validator(schema, { formats })
    assert.strictEqual(v.validate({ x }).valid, expected, `bounded '' format on ${x}: validate()`)
    assert.strictEqual(v.isValidObject({ x }), expected, `bounded '' format on ${x}: isValidObject()`)
    assert.strictEqual(compileToJSCodegen(schema, null, formats)({ x }), expected, `bounded '' format on ${x}: compileToJSCodegen`)
    assert.strictEqual(compileToJSCodegenWithErrors(schema, null, formats)({ x }, true).valid, expected, `bounded '' format on ${x}: compileToJSCodegenWithErrors`)
    const comb = compileToJSCombined(schema, VALID, null, formats)
    if (comb) assert.strictEqual(comb({ x }).valid, expected, `bounded '' format on ${x}: compileToJSCombined`)
    assert.strictEqual(load(toStandaloneModule(schema, { format: 'cjs', formats })).isValid({ x }), expected, `bounded '' format on ${x}: standalone`)
  }
}

console.log(`ok: the caller's format function wins over the built-in check on every path (${compared} cases)`)
