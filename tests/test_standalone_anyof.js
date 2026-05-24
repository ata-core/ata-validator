'use strict'

// toStandaloneModule hoists anyOf/oneOf branch checks into preamble functions.
// Those must be emitted into the standalone module or the output references
// undefined names (e.g. _af1_b0) and throws on load.

const { Validator } = require('..')

let pass = 0, fail = 0
function check(cond, msg) { if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) } }
function load(code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports }

console.log('\ntoStandaloneModule anyOf/oneOf hoisted helpers\n')

const anyOfSchema = {
  type: 'object',
  properties: {
    pet: {
      anyOf: [
        { type: 'object', properties: { bark: { type: 'boolean' } }, required: ['bark'] },
        { type: 'object', properties: { meow: { type: 'boolean' } }, required: ['meow'] },
      ],
    },
  },
}

const anyOfCode = new Validator(anyOfSchema).toStandaloneModule({ format: 'cjs' })
check(anyOfCode != null, 'anyOf schema produces a standalone module')
let anyOfMod
try { anyOfMod = load(anyOfCode) } catch (e) { console.log('        load threw:', e.message) }
check(anyOfMod && typeof anyOfMod.validate === 'function', 'anyOf module loads without ReferenceError')
if (anyOfMod) {
  check(anyOfMod.validate({ pet: { bark: true } }).valid === true, 'anyOf: first branch accepted')
  check(anyOfMod.validate({ pet: { meow: true } }).valid === true, 'anyOf: second branch accepted')
  check(anyOfMod.validate({ pet: { chirp: true } }).valid === false, 'anyOf: non-matching rejected')
}

const oneOfSchema = {
  type: 'object',
  properties: {
    shape: {
      oneOf: [
        { type: 'object', properties: { radius: { type: 'number' } }, required: ['radius'] },
        { type: 'object', properties: { side: { type: 'number' } }, required: ['side'] },
      ],
    },
  },
}
const oneOfCode = new Validator(oneOfSchema).toStandaloneModule({ format: 'cjs' })
let oneOfMod
try { oneOfMod = load(oneOfCode) } catch (e) { console.log('        load threw:', e.message) }
check(oneOfMod && typeof oneOfMod.validate === 'function', 'oneOf module loads without ReferenceError')
if (oneOfMod) {
  check(oneOfMod.validate({ shape: { radius: 1 } }).valid === true, 'oneOf: single match accepted')
  check(oneOfMod.validate({ shape: {} }).valid === false, 'oneOf: zero match rejected')
}

// The same hoisted helpers must travel through the multi-schema bundlers.
function loadFirst(code) { const m = { exports: {} }; new Function('module', 'exports', code)(m, m.exports); return m.exports[0] }
for (const method of ['bundleStandalone', 'bundleCompact']) {
  let fn
  try { fn = loadFirst(Validator[method]([anyOfSchema], { format: 'cjs' })) } catch (e) { console.log(`        ${method} load threw:`, e.message) }
  check(typeof fn === 'function', `${method}: produces a callable validator`)
  if (fn) {
    let okBark = false, okChirp = false
    try { okBark = fn({ pet: { bark: true } }).valid === true; okChirp = fn({ pet: { chirp: true } }).valid === false } catch (e) { console.log(`        ${method} call threw:`, e.message) }
    check(okBark, `${method}: anyOf valid branch accepted`)
    check(okChirp, `${method}: anyOf non-matching rejected`)
  }
}

console.log(`\n${pass}/${pass + fail} passed\n`)
process.exit(fail > 0 ? 1 : 0)
