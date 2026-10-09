'use strict'

// validateJSON's rejections resolve the position map on the first read of an
// error's `dataFrame` or `anchor`, not when the list is read: the map is a
// walk of the document, and a caller that reads messages and paths never
// needs it. On a 60 KB document with 137 errors, reading the list went from
// 907 to 505 us; reading every frame costs what it did. Held here: no map is
// built for messages, one map serves every frame, the frames are the eager
// shape (present when the text has the value, absent otherwise, enumerable
// and serialized), and an assignment replaces the accessor.

const assert = require('node:assert')
const { Validator } = require('..')

const v = new Validator({
  type: 'object',
  properties: { a: { type: 'integer' }, b: { type: 'string' }, d: { type: 'string', default: 'x' } },
  additionalProperties: false,
})
let builds = 0
const pos = v._pos()
const targeted = pos.targeted.bind(pos)
pos.targeted = (text, wanted) => { builds++; return targeted(text, wanted) }

const text = '{\n  "a": "x",\n  "b": 1,\n  "c": 2\n}'
const r = v.validateJSON(text)
assert.strictEqual(r.valid, false)
const errors = r.errors
assert.strictEqual(errors.length, 3)
assert.deepStrictEqual(errors.map((e) => e.message.length > 0), [true, true, true])
assert.strictEqual(builds, 0, 'reading the list and its messages builds no position map')

// One read resolves the map once for every error of the list.
assert.deepStrictEqual(errors[0].dataFrame, { byteOffset: 9, length: 3, line: 2, col: 8, text: '  "a": "x",' })
assert.strictEqual(builds, 1)
assert.strictEqual(errors[1].dataFrame.line, 3)
assert.deepStrictEqual(errors[2].anchor, { line: 4, col: 8, length: 1, keyLine: 4, keyCol: 3, keyLength: 3 })
assert.strictEqual(builds, 1, 'one map serves the whole list')
assert.ok(Object.prototype.hasOwnProperty.call(errors[0], 'dataFrame') && Object.getOwnPropertyDescriptor(errors[0], 'dataFrame').value, 'a resolved frame is a plain data property')

// Serialized as data, before and after resolution.
const fresh = v.validateJSON(text).errors
const json = JSON.parse(JSON.stringify(fresh))
assert.deepStrictEqual(json[0].dataFrame, { byteOffset: 9, length: 3, line: 2, col: 8, text: '  "a": "x",' })
assert.deepStrictEqual(json[2].anchor, { line: 4, col: 8, length: 1, keyLine: 4, keyCol: 3, keyLength: 3 })
assert.ok(Object.keys(fresh[0]).includes('dataFrame'))

// An assignment replaces the accessor.
const again = v.validateJSON(text).errors
again[0].dataFrame = { line: 99 }
assert.deepStrictEqual(again[0].dataFrame, { line: 99 })

// A frame the text cannot give goes away on resolution, as the eager path left it out:
// the default for `d` is applied before validation and has no place in the text.
const d = new Validator({ type: 'object', properties: { d: { type: 'string', default: 7 } } }, { useDefaults: true })
const de = d.validateJSON('{}').errors
assert.strictEqual(de.length, 1)
assert.strictEqual(de[0].path, '/d')
assert.strictEqual(de[0].dataFrame, undefined)
assert.ok(!Object.prototype.hasOwnProperty.call(de[0], 'dataFrame'), 'an absent frame is not an own key once resolved')
assert.strictEqual(JSON.stringify(de[0]).includes('dataFrame'), false)

console.log('ok: validateJSON resolves positions on the first frame read, once per list, in the eager shape')
