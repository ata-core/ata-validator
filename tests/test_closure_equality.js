'use strict'

// enum, const and uniqueItems on the closure compiler (compileToJS in
// lib/js-compiler.js), which answers a Validator with default options when the
// code generator declines a schema and the closure compiler does not: a
// `dependentRequired` whose list is empty is one such schema. It compared
// values by a canonical string of each, which wrote a string inside an array
// or object without quotes, so ["a", "b"] and ["a,string:b"] were one item and
// `uniqueItems` refused [["a","b"],["a,string:b"]]; it also wrote NaN as null
// and a hole as nothing, so `const: []` accepted [,] and `const: [1, null, 2]`
// accepted [1, NaN, 2], which only code in the same process can make. It now
// compares with the functions the interpreted engine uses (lib/unique-items.js).
//
// Every answer here is held to the interpreted engine, and the JSON ones to
// the value they must have.

const assert = require('assert')
const { Validator } = require('..')
const jc = require('../lib/js-compiler.js')

const DECLINE = { dependentRequired: { zzz: [] } }
let checked = 0

function agree(label, schema, data, want) {
  const s = { ...schema, ...DECLINE }
  const interp = new Validator(s, { engine: 'interpreter' }).validate(data).valid
  if (want !== undefined) assert.strictEqual(interp, want, `${label}: the interpreted engine said ${interp}`)
  const v = new Validator(s, {})
  assert.strictEqual(v.engine(), 'closure', `${label}: the closure compiler answers this schema`)
  const fn = jc.compileToJS(s, null, null)
  assert.ok(fn, `${label}: compileToJS compiles it`)
  for (const [where, got] of [['validate', v.validate(data).valid], ['isValidObject', v.isValidObject(data)], ['compileToJS', !!fn(data)]]) {
    assert.strictEqual(got, interp, `${label}: ${where} said ${got}, the interpreted engine ${interp}`)
    checked++
  }
}

// From JSON: strings that spell the canonical form of other items.
const pairs = [
  [['a', 'b'], ['a,string:b'], false],
  [{ a: 'x', b: 'y' }, { a: 'x,"b":string:y' }, false],
  [['1'], [1], false],
  [[true], ['true'], false],
  [{ a: null }, { a: 'null' }, false],
  [[''], [], false],
  [{ b: 2, a: 1 }, { a: 1, b: 2 }, true],
  [[-0], [0], true],
]
for (const [x, y, equal] of pairs) {
  agree(`uniqueItems ${JSON.stringify([x, y])}`, { uniqueItems: true }, [x, y], !equal)
  agree(`uniqueItems ${JSON.stringify([y, x])}`, { uniqueItems: true }, [y, x], !equal)
  agree(`const ${JSON.stringify(x)} on ${JSON.stringify(y)}`, { const: x }, y, equal)
  agree(`enum [${JSON.stringify(x)}] on ${JSON.stringify(y)}`, { enum: [x, 'zz'] }, y, equal)
}

// In-process values: the interpreted engine's answer, whatever it is.
const odd = [[1, , 2], [1, undefined, 2], [1, null, 2], [1, NaN, 2], [,], [undefined], [], [NaN], { a: 1, b: undefined }]
for (const x of [[1, null, 2], [], [null], { a: 1 }]) {
  for (const y of odd) {
    agree(`const ${JSON.stringify(x)} on an in-process value`, { const: x }, y)
    agree(`enum on an in-process value`, { enum: [x] }, y)
  }
}
for (const a of odd) for (const b of odd) agree('uniqueItems on in-process values', { uniqueItems: true }, [a, b])

console.log(`ok: enum, const and uniqueItems on the closure compiler agree with the interpreted engine (${checked} answers)`)
