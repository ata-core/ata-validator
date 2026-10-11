'use strict'

// A small object definition referenced from many places is emitted as several
// functions with one body, so that each sees few object shapes (see
// sharedDefCopy in lib/js-compiler.js; SchemaStore's detekt went from 6.3 to
// 1.1 µs a document). The copies must answer as the interpreter does, and a
// definition with no properties to read must stay one function.

const assert = require('assert')
const { Validator } = require('..')
const aot = require('../aot')

// Shaped like detekt: three hundred rules, large enough that definitions
// are shared rather than expanded at every reference (EXPANDED_SHARE), each `allOf` the shared rule properties and
// its own options, so the shared definition sees three hundred object shapes.
const rule = { type: 'object', properties: { active: { type: 'boolean' }, excludes: { type: 'array', items: { type: 'string' } }, ignoreAnnotated: { type: 'array', items: { type: 'string' } } } }
const name = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]*$', description: 'A rule label: lower case letters, digits and hyphens, starting with a letter' }
const props = {}
for (let i = 0; i < 300; i++) {
  props['R' + i] = { allOf: [{ $ref: '#/$defs/rule' }, { properties: { ['opt' + i]: { type: 'integer', minimum: 0, maximum: 1000 }, ['flag' + i]: { type: 'boolean' }, ['mode' + i]: { enum: ['a', 'b', 'c'] }, label: { $ref: '#/$defs/name' } } }] }
}
const schema = { $defs: { rule, name }, type: 'object', properties: props }

const code = new Validator(schema)
const interp = new Validator(schema, { engine: 'interpreter' })
const doc = {}
for (let i = 0; i < 300; i++) doc['R' + i] = { active: i % 2 === 0, ['opt' + i]: i, label: 'r' + i, excludes: ['a'] }
const docs = [doc, {}, { R0: { active: 'yes' } }, { R299: { excludes: [1] } }, { R7: { opt7: 'x' } }, { R3: { label: '' } }, { R4: { label: 'Bad' } }, { R1: null }]
for (let i = 0; i < 300; i += 7) docs.push({ ['R' + i]: { active: 1 } }, { ['R' + i]: { ['opt' + i]: 1.5, active: true } })
for (const d of docs) {
  assert.strictEqual(code.isValidObject(d), interp.isValidObject(d), JSON.stringify(d))
  assert.strictEqual(code.validate(d).valid, interp.validate(d).valid, JSON.stringify(d))
}
const src = aot.toStandaloneModule(new Validator(schema), { format: 'cjs' })
const copies = (src.match(/function _dv\d+_rule_c\d+\(/g) || []).length
assert.ok(copies >= 8, `the rule definition is copied: ${copies}`)
assert.ok(/function _dv\d+_name\(/.test(src), 'the string definition is shared')
assert.ok(!/function _dv\d+_name_c\d+\(/.test(src), 'a string definition is not copied')
console.log(`ok: ${copies + 1} copies of a shared definition answer as the interpreter on ${docs.length} documents`)
