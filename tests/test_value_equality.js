'use strict'

// `const` and `enum` compare an instance to a value, and JSON Schema says that
// comparison is by value: two objects with the same members are equal whatever
// order their keys happen to be written in, and nesting does not change that.
//
// The code generator used to answer this by comparing `JSON.stringify` output,
// which is a comparison of serialized form rather than of value, so it rejected
// `{b: 2, a: 1}` against `enum: [{a: 1, b: 2}]`. The interpreted engine has
// always compared structurally, so the two engines disagreed.
//
// The official suite does not cover reordered keys for `enum`, and the
// entry-point agreement test compares the generators against each other, where
// all of them were wrong in the same way. Neither would have caught it. This
// pins the answer itself, through every engine that can produce one.

const assert = require('assert')
const { Validator } = require('..')
const { createInterpreter } = require('../lib/interpreter.js')

let passed = 0

function check(name, schema, data, expected) {
  const v = new Validator(schema)
  const viaValidate = v.validate(data).valid
  const viaBoolean = v.isValidObject(data)
  const viaInterpreter = createInterpreter(schema, {}).validate(data).valid
  assert.strictEqual(viaValidate, expected, `${name}: validate() said ${viaValidate}`)
  assert.strictEqual(viaBoolean, expected, `${name}: isValidObject() said ${viaBoolean}`)
  assert.strictEqual(viaInterpreter, expected, `${name}: the interpreter said ${viaInterpreter}`)
  console.log(`  PASS  ${name}`)
  passed++
}

// enum, objects compared by value
check('enum object with the same members in another order', { enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }, true)
check('enum object nested one level deeper', { enum: [{ x: { a: 1, b: 2 } }] }, { x: { b: 2, a: 1 } }, true)
check('enum object inside a property', { type: 'object', properties: { k: { enum: [{ a: 1, b: 2 }] } } }, { k: { b: 2, a: 1 } }, true)
check('enum object with a member missing', { enum: [{ a: 1, b: 2 }] }, { a: 1 }, false)
check('enum object with an extra member', { enum: [{ a: 1 }] }, { a: 1, b: 2 }, false)
check('enum mixing primitives and objects, object matches', { enum: ['x', 3, { a: 1, b: 2 }] }, { b: 2, a: 1 }, true)
check('enum mixing primitives and objects, primitive matches', { enum: ['x', 3, { a: 1 }] }, 3, true)
check('enum mixing primitives and objects, nothing matches', { enum: ['x', 3, { a: 1 }] }, true, false)

// enum, arrays stay positional
check('enum array in the same order', { enum: [[1, 2]] }, [1, 2], true)
check('enum array reordered is a different value', { enum: [[1, 2]] }, [2, 1], false)
check('enum array of objects, members reordered', { enum: [[{ a: 1, b: 2 }]] }, [{ b: 2, a: 1 }], true)

// const, same rules
check('const object with the same members in another order', { const: { a: 1, b: 2 } }, { b: 2, a: 1 }, true)
check('const object nested one level deeper', { const: { x: { a: 1, b: 2 } } }, { x: { b: 2, a: 1 } }, true)
check('const object with a member missing', { const: { a: 1, b: 2 } }, { a: 1 }, false)
check('const array reordered is a different value', { const: [1, 2] }, [2, 1], false)

// A member named like something on Object.prototype is an ordinary member.
check('const object whose member shadows a prototype name', { const: { toString: 1 } }, { toString: 1 }, true)
check('const object compared against an instance without that member', { const: { toString: 1 } }, {}, false)
check('enum object with a __proto__ member', { enum: [{ ['__proto__']: 1 }] }, JSON.parse('{"__proto__":1}'), true)

// Numbers compare by value, not by the form they were written in.
check('enum number written with a trailing zero', { enum: [1.0] }, 1, true)
check('const number written with a trailing zero', { const: 1.0 }, 1, true)
check('enum does not treat 1 and true as equal', { enum: [1] }, true, false)
check('enum does not treat 0 and null as equal', { enum: [0] }, null, false)

// The empty enum matches nothing at all.
check('empty enum rejects an object', { enum: [] }, { a: 1 }, false)
check('empty enum rejects a string', { enum: [] }, 'x', false)

console.log(`\n${passed} passed`)
