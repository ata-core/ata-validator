'use strict'

// `unevaluatedProperties`/`unevaluatedItems` beside a `$ref` back to the root
// must count what the root evaluates. The generated code did not, and
// rejected valid documents; such a schema now goes to the interpreted engine.
// Found through 2019-09's `$recursiveRef` tests; the shape is plain 2020-12.

const assert = require('assert')
const { Validator } = require('..')

const S = 'https://json-schema.org/draft/2020-12/schema'
const variants = [
  { $schema: S, $ref: '#/$defs/t', properties: { name: { type: 'string' } }, $defs: { t: { type: 'object', properties: { node: true, branches: { unevaluatedProperties: false, $ref: '#' } }, required: ['node'] } } },
  { $schema: S, $ref: '#/$defs/t', properties: { name: { type: 'string' } }, $defs: { t: { type: 'object', properties: { node: true, branches: { unevaluatedProperties: false, $ref: '#/$defs/t' } }, required: ['node'] } } },
  { $schema: S, properties: { a: true, child: { $ref: '#' } }, unevaluatedProperties: false },
  { $schema: S, $ref: '#/$defs/t', prefixItems: [true, true, { type: 'string' }], $defs: { t: { type: 'array', prefixItems: [{ type: 'number' }, { unevaluatedItems: false, $ref: '#' }] } } },
  { $schema: S, $ref: '#/$defs/t', prefixItems: [true, true, { type: 'string' }], $defs: { t: { type: 'array', prefixItems: [{ type: 'number' }, { unevaluatedItems: false, $ref: '#/$defs/t' }] } } },
]
const docs = [
  { name: 'a', node: 1, branches: { name: 'b', node: 2 } }, { name: 'a', node: 1, branches: { foo: 'b', node: 2 } }, { node: 1, branches: { node: 2 } },
  { a: 1, child: { a: 2 } }, { a: 1, child: { b: 2 } }, { a: 1, b: 2 },
  [1, [2, [], 'b'], 'a'], [1, [2, [], 'b', 'too many'], 'a'], [1, [2]],
]
let compared = 0
for (const s of variants) {
  const cg = new Validator(s)
  const ip = new Validator(s, { engine: 'interpreter' })
  for (const d of docs) {
    assert.strictEqual(cg.validate(d).valid, ip.validate(d).valid, JSON.stringify(s) + ' on ' + JSON.stringify(d))
    assert.strictEqual(cg.isValidObject(d), ip.validate(d).valid, 'isValidObject ' + JSON.stringify(d))
    compared++
  }
}
// The tree from the suite: valid branches are accepted.
assert.strictEqual(new Validator(variants[0]).validate(docs[0]).valid, true)
assert.strictEqual(new Validator(variants[0]).validate(docs[1]).valid, false)
console.log(`unevaluated beside a root $ref: ${compared} answers agree between the engines`)
