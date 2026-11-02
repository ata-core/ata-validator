// A verdict on a node with unevaluatedProperties reads the evaluated names off
// the schema when it can (lib/ir/front.mjs staticNames): properties and
// patternProperties at the node and behind $ref and allOf. Any keyword that
// makes them depend on the value sends the node to the annotation collector.
// Each schema here is held to the current engine's verdicts, and to the path
// it should take.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import * as K from '../lib/kernels/index.mjs'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')

const load = (schema) => {
  const src = specialize(schema, { assertFormat: false, verdict: true })
  const root = /export function isValid\(d\)\{return (\w+)\(/.exec(src)[1]
  const body = src.slice(src.indexOf(`function ${root}(`)).split('\nfunction ')[0]
  return { m: new Function('K', functionBody(src))(K), collects: /\ba\d+\(/.test(body) || body.includes('newAnn') }
}

const cases = [
  ['$ref and properties', false, {
    $ref: '#/$defs/base', properties: { b: { type: 'integer' } }, unevaluatedProperties: false,
    $defs: { base: { type: 'object', properties: { a: { type: 'string' } }, not: { required: ['z'] } } },
  }, [[{ a: 'x', b: 1 }, true], [{}, true], [{ c: 1 }, false], [{ a: 1 }, false], [{ a: 'x', z: 1 }, false], [{ b: 'no' }, false], ['text', false]]],
  ['allOf, patterns and a schema for the rest', false, {
    type: 'object', allOf: [{ properties: { a: true } }, { patternProperties: { '^x-': { type: 'string' } } }], unevaluatedProperties: { type: 'number' },
  }, [[{ a: [], 'x-1': 's', n: 2 }, true], [{ n: 'no' }, false], [{ 'x-1': 3 }, false], [{ a: null, m: 1.5 }, true]]],
  ['unevaluatedProperties true', false, {
    type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: true,
  }, [[{ a: 'x', z: 1 }, true], [{ a: 1 }, false]]],
  ['anyOf: the collector', true, {
    type: 'object', anyOf: [{ properties: { a: true } }, { properties: { b: true } }], unevaluatedProperties: false,
  }, [[{ a: 1 }, true], [{ b: 1 }, true], [{ a: 1, b: 1 }, true], [{ c: 1 }, false]]],
  ['an inherited and a non-enumerable name', false, {
    type: 'object', properties: { a: true }, unevaluatedProperties: false,
  }, [[Object.create({ c: 1 }), true], [Object.defineProperty({}, 'c', { value: 1, enumerable: false }), true], [JSON.parse('{"__proto__": 1}'), false]]],
]
let checked = 0
for (const [name, collects, schema, docs] of cases) {
  const { m, collects: got } = load(schema)
  assert.strictEqual(got, collects, `${name}: the verdict ${collects ? 'should' : 'should not'} use the annotation collector`)
  const ata = new Validator(schema)
  for (const [d, want] of docs) {
    assert.strictEqual(ata.isValidObject(d), want, `current engine, ${name}, ${JSON.stringify(d)}`)
    assert.strictEqual(m.isValid(d), want, `${name}: isValid on ${JSON.stringify(d)}`)
    assert.strictEqual(m.validate(d).valid, want, `${name}: validate() on ${JSON.stringify(d)}`)
    checked++
  }
}

// Thirty levels of allOf naming the next level twice: read once per schema,
// not 2^30 times.
const $defs = {}
for (let i = 0; i < 30; i++) $defs['l' + i] = { properties: { ['p' + i]: true }, allOf: i < 29 ? [{ $ref: `#/$defs/l${i + 1}` }, { $ref: `#/$defs/l${i + 1}` }] : [] }
const t0 = Date.now()
const { m: deep, collects: deepCollects } = load({ type: 'object', $ref: '#/$defs/l0', unevaluatedProperties: false, $defs })
assert.ok(Date.now() - t0 < 5000, `thirty shared levels took ${Date.now() - t0} ms to compile`)
assert.strictEqual(deepCollects, false, 'thirty shared levels: the names should be read off the schema')
assert.strictEqual(deep.isValid({ p0: 1, p29: 2 }), true)
assert.strictEqual(deep.isValid({ p30: 1 }), false)

console.log(`ok: verdicts with unevaluatedProperties read off the schema agree with the current engine on ${checked} documents`)
