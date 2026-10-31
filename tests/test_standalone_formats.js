'use strict'

// Every standalone emit path must embed user-supplied format functions. The
// boolean and error bodies both reference `_uf_<name>` helpers; the output has
// to declare them or it throws "_uf_<name> is not defined" on first validate,
// and the error path must check the format too so validate() stays consistent
// with the boolean isValid().

const { Validator } = require('..')
const aot = require('../lib/aot')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }
function load(code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports }

const formats = { 'even-len': (s) => typeof s === 'string' && s.length % 2 === 0 }
const schema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'even-len' } },
  required: ['id'],
}

// Run the shared contract against one validate(data) -> { valid, errors } fn.
function checkValidator(label, validate) {
  let threw = null, okRes, badRes
  try { okRes = validate({ id: 'abcd' }); badRes = validate({ id: 'abc' }) }
  catch (e) { threw = e.message }
  check(threw === null, `${label}: does not throw on the custom format` + (threw ? ` (threw: ${threw})` : ''))
  if (threw) return
  check(okRes.valid === true, `${label}: accepts a value passing the custom format`)
  check(badRes.valid === false, `${label}: rejects a value failing the custom format`)
  check(
    badRes.valid === false && (badRes.errors || []).some((e) => e.keyword === 'format'),
    `${label}: emits a format error for the failing value`,
  )
}

console.log('\nstandalone emit paths embed custom (function) formats\n')

// 1. toStandaloneModule
{
  const code = aot.toStandaloneModule(new Validator(schema, { formats }), { format: 'cjs' })
  check(code != null, 'toStandaloneModule: produces a module')
  const mod = code ? load(code) : null
  if (mod) checkValidator('toStandaloneModule', mod.validate)
}

// 2. bundleStandalone (the path the rjsf precompiled adapter uses)
{
  const code = Validator.bundleStandalone([schema], { format: 'cjs', formats })
  check(code != null, 'bundleStandalone: produces a module')
  const arr = code ? load(code) : null
  if (arr) checkValidator('bundleStandalone', arr[0])
}

// 3. bundleCompact
{
  const code = Validator.bundleCompact([schema], { format: 'cjs', formats })
  check(code != null, 'bundleCompact: produces a module')
  const arr = code ? load(code) : null
  if (arr) checkValidator('bundleCompact', arr[0])
}

// Two format names that differ only in a character outside [A-Za-z0-9_]
// used to share one helper name, `_uf_foo_bar`, so whichever function was
// bound first answered for both, and a bundle deduplicated on that name
// ran one schema's checker for another schema.
console.log('\nformat names that differ outside [A-Za-z0-9_] keep their own function\n')
{
  const two = { 'foo-bar': (s) => s === 'dash', 'foo_bar': (s) => s === 'under' }
  const both = { type: 'object', properties: { a: { type: 'string', format: 'foo-bar' }, b: { type: 'string', format: 'foo_bar' } } }
  const reversed = { type: 'object', properties: { b: { type: 'string', format: 'foo_bar' }, a: { type: 'string', format: 'foo-bar' } } }
  const A = { type: 'string', format: 'foo-bar' }
  const B = { type: 'string', format: 'foo_bar' }
  const expect = (label, validate) => {
    check(validate({ a: 'dash', b: 'under' }).valid === true, `${label}: each format takes its own value`)
    check(validate({ a: 'dash', b: 'dash' }).valid === false, `${label}: foo_bar rejects foo-bar's value`)
    check(validate({ a: 'under', b: 'under' }).valid === false, `${label}: foo-bar rejects foo_bar's value`)
  }
  for (const [name, schema] of [['declared dash first', both], ['declared underscore first', reversed]]) {
    const rt = new Validator(schema, { formats: two })
    expect(`runtime ${name}`, (d) => rt.validate(d))
    for (let i = 0; i < 70; i++) rt.validate({ a: 'dash', b: 'under' })
    expect(`runtime warm ${name}`, (d) => rt.validate(d))
    expect(`runtime isValidObject ${name}`, (d) => ({ valid: rt.isValidObject(d) }))
    expect(`runtime validateJSON ${name}`, (d) => rt.validateJSON(JSON.stringify(d)))
    expect(`interpreter ${name}`, (d) => new Validator(schema, { formats: two, engine: 'interpreter' }).validate(d))
    const mod = load(aot.toStandaloneModule(new Validator(schema, { formats: two }), { format: 'cjs' }))
    expect(`toStandaloneModule ${name}`, mod.validate)
    expect(`toStandaloneModule isValid ${name}`, (d) => ({ valid: mod.isValid(d) }))
    const inj = load(aot.toStandaloneModule(new Validator(schema, { formats: two }), { format: 'cjs', formatMode: 'inject' }))
    inj.setFormats(two)
    expect(`toStandaloneModule inject ${name}`, inj.validate)
    for (const build of ['bundleStandalone', 'bundleCompact']) {
      const arr = load(Validator[build]([schema, A, B], { format: 'cjs', formats: two }))
      expect(`${build} ${name}`, arr[0])
      check(arr[1]('dash').valid === true && arr[1]('under').valid === false, `${build} ${name}: the foo-bar validator runs foo-bar`)
      check(arr[2]('under').valid === true && arr[2]('dash').valid === false, `${build} ${name}: the foo_bar validator runs foo_bar`)
    }
  }
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
