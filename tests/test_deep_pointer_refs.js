'use strict'

// A local `$ref` that points deeper than a top-level definition
// (`#/properties/foo`, `#/definitions/a/properties/id`, `#/$defs/a/items/0`) is
// compiled: normalizeDeepRefs in lib/js-compiler.js resolves the pointer and
// hands the generators its target as a definition of its own. Before, every
// such schema ran on the interpreted engine. This holds the generated engine
// to the interpreter on fixed shapes and on random schemas: escaped keys,
// array indexes, a pointer to an ancestor (a cycle), draft 7's `definitions`
// (renamed to `$defs` before the generators see it), `$ref` beside other
// keywords, and references through `$id`s and URNs, which normalizeRefs
// resolves with the interpreter's resolver. It counts the schemas that
// compiled, so it cannot pass by declining them all.

const assert = require('node:assert')
const { Validator } = require('..')

const json = (x) => JSON.stringify(x)
let compared = 0, compiled = 0, schemas = 0

function check (schema, docs, mustCompile) {
  schemas++
  for (const richErrors of [true, false]) {
    const v = new Validator(schema, { richErrors })
    const ref = new Validator(schema, { richErrors, engine: 'interpreter' })
    for (let i = 0; i < 3; i++) for (const d of docs) {
      assert.strictEqual(json(v.validate(d)), json(ref.validate(d)), `${json(schema)} on ${json(d)}`)
      assert.strictEqual(v.isValidObject(d), ref.validate(d).valid)
      compared++
    }
    if (richErrors) {
      if (v.engine() === 'codegen') compiled++
      if (mustCompile === true) assert.strictEqual(v.engine(), 'codegen', `should compile: ${json(schema)}`)
      if (mustCompile === false) assert.notStrictEqual(v.engine(), 'codegen', `should stay on the interpreter: ${json(schema)}`)
    }
  }
}

// Fixed shapes.
check({ properties: { foo: { type: 'integer' }, bar: { $ref: '#/properties/foo' } } }, [{ bar: 1 }, { bar: 'x' }, { foo: 'x', bar: 2.5 }], true)
check({ definitions: { a: { properties: { id: { type: 'string', minLength: 2 } } } }, properties: { x: { $ref: '#/definitions/a/properties/id' } } }, [{ x: 'ab' }, { x: 'a' }, { x: 3 }], true)
check({ $schema: 'http://json-schema.org/draft-07/schema#', definitions: { a: { properties: { id: { type: 'string' } } } }, properties: { x: { $ref: '#/definitions/a/properties/id' } } }, [{ x: 'ab' }, { x: 3 }], true)
check({ $defs: { 'a/b': { type: 'string' }, 'c~d': { properties: { 'e/f': { minimum: 3 } } } }, properties: { p: { $ref: '#/$defs/c~0d/properties/e~1f' } } }, [{ p: 4 }, { p: 1 }, { p: 'x' }], true)
check({ prefixItems: [{ type: 'string' }, { type: 'number' }], items: { $ref: '#/prefixItems/1' } }, [['a', 1, 2], ['a', 1, 'x'], [1]], true)
check({ properties: { kids: { type: 'array', items: { $ref: '#/properties/kids' } } } }, [{ kids: [[], [[]]] }, { kids: [[1]] }, { kids: 'x' }, { kids: [[[]], 'no'] }], true)
check({ $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node/properties/next' }, v: { type: 'integer' } } } }, $ref: '#/$defs/node' }, [{ v: 1 }, { v: 'x' }, { next: { v: 1 } }], undefined)
check({ properties: { a: { type: 'string' }, b: { $ref: '#/properties/a', maxLength: 2 } } }, [{ b: 'ab' }, { b: 'abc' }, { b: 1 }], undefined)
check({ properties: { e: { enum: [{ $ref: '#/nope' }] } } }, [{ e: { $ref: '#/nope' } }, { e: 1 }], true)
// A pointer through a subschema with its own base: resolved by the
// interpreter's resolver at compile time (normalizeRefs), so it compiles too.
check({ $defs: { r: { $id: 'http://example.com/r', properties: { x: { type: 'string' } } } }, properties: { a: { $ref: '#/$defs/r/properties/x' } } }, [{ a: 'x' }, { a: 1 }], true)
check({ $id: 'urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed', properties: { foo: { $ref: 'urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed#/$defs/bar' } }, $defs: { bar: { type: 'string' } } }, [{ foo: 'x' }, { foo: 12 }], true)
check({ $id: 'http://example.com/root.json', $defs: { A: { $id: 'nested.json', $defs: { B: { $id: '#foo', type: 'integer' } }, properties: { n: { $ref: '#foo' } } } }, properties: { x: { $ref: 'nested.json' } } }, [{ x: { n: 1 } }, { x: { n: 'a' } }], undefined)
check({ $id: 'http://example.com/tree', type: 'object', properties: { kids: { type: 'array', items: { $ref: 'http://example.com/tree' } }, v: { type: 'integer' } } }, [{ kids: [{ v: 1 }, { kids: [{ v: 'x' }] }] }, { v: 2 }], undefined)

// Random schemas with deep pointers into themselves.
let seed = Number(process.env.SEED) || 4242
const rnd = (k) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % k }
const pick = (a) => a[rnd(a.length)]
const leaf = () => pick([{ type: 'string', minLength: 2 }, { type: 'integer', maximum: 5 }, { enum: ['a', 'b', 1] }, { type: 'boolean' }, { const: 3 }, { type: 'array', items: { type: 'number' } }])
for (let n = 0; n < 300; n++) {
  const defs = { base: { type: 'object', properties: { id: leaf(), 'x/y': leaf(), tags: { type: 'array', items: leaf() } }, required: rnd(2) ? ['id'] : [] } }
  const pointers = ['#/$defs/base/properties/id', '#/$defs/base/properties/x~1y', '#/$defs/base/properties/tags', '#/$defs/base/properties/tags/items', '#/properties/first', '#/$defs/base']
  const schema = { $defs: defs, type: 'object', properties: { first: leaf(), a: { $ref: pick(pointers) }, b: { type: 'array', items: { $ref: pick(pointers) } } } }
  if (rnd(3) === 0) schema.properties.c = { $ref: pick(pointers), ...(rnd(2) ? { description: 'x' } : {}) }
  const vals = ['ab', 'a', 1, 7, true, null, [1, 2], ['ab'], { id: 'ab' }, { id: 1, 'x/y': 'zz', tags: [1] }, 3]
  const docs = []
  for (let k = 0; k < 6; k++) docs.push({ first: pick(vals), a: pick(vals), b: [pick(vals), pick(vals)], c: pick(vals) })
  check(schema, docs, undefined)
}

assert.ok(compiled >= 250, `too few schemas compiled: ${compiled} of ${schemas}`)
assert.ok(compared >= 10000, `too few comparisons: ${compared}`)
console.log(`ok: deep local pointers compile and agree with the interpreter (${compiled} of ${schemas} schemas compiled, ${compared} results compared)`)
