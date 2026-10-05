'use strict'

// A schema that reaches its root again through a definition used once, a tree
// whose nodes hold trees, gets the one-pass combined function. The root's
// function is written while the definition is still being expanded on the
// way in, and the definition reached again inside that function was taken
// for a cycle, so the schema had no combined function and every error read
// went to the interpreter. The combined function is called directly here and
// held to the interpreter on random trees, valid and not.

const assert = require('node:assert')
const { Validator } = require('..')
const jc = require('../lib/js-compiler')

const schemas = [
  { $schema: 'http://json-schema.org/draft-07/schema#', $id: 'http://localhost:1234/tree', type: 'object', properties: { meta: { type: 'string' }, nodes: { type: 'array', items: { $ref: 'node' } } }, required: ['meta', 'nodes'], definitions: { node: { $id: 'http://localhost:1234/node', type: 'object', properties: { value: { type: 'number' }, subtree: { $ref: 'tree' } }, required: ['value'] } } },
  { type: 'object', properties: { name: { type: 'string', minLength: 1 }, children: { type: 'array', items: { $ref: '#/$defs/child' } } }, required: ['name'], $defs: { child: { type: 'object', properties: { weight: { type: 'integer' }, tree: { $ref: '#' } }, required: ['weight'] } } },
  { $defs: { a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } }, b: { type: 'object', properties: { root: { $ref: '#' }, n: { type: 'number' } } } }, type: 'object', properties: { a: { $ref: '#/$defs/a' }, s: { type: 'string' } } },
]

let seed = 5
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const tree = (d) => {
  const o = {}
  if (rnd() < 0.9) o.meta = pick(['m', 1])
  if (rnd() < 0.9) o.name = pick(['n', '', 3])
  if (rnd() < 0.5) o.s = pick(['x', 2])
  if (d < 4 && rnd() < 0.8) o.nodes = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ value: pick([1, 'v']), ...(rnd() < 0.5 ? { subtree: tree(d + 1) } : {}) }))
  if (d < 4 && rnd() < 0.8) o.children = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ weight: pick([1, 1.5]), ...(rnd() < 0.5 ? { tree: tree(d + 1) } : {}) }))
  if (d < 4 && rnd() < 0.6) o.a = { b: { n: pick([1, 'x']), ...(rnd() < 0.6 ? { root: tree(d + 1) } : {}) } }
  return o
}
const shape = (errs) => (errs || []).map((e) => JSON.stringify([e.keyword, e.instancePath, e.schemaPath, e.params])).sort().join('\n')

let compared = 0, rejected = 0
for (const [i, schema] of schemas.entries()) {
  const comb = jc.compileToJSCombined(schema, { valid: true, errors: [] }, null, null, { runtimeShape: true })
  assert.ok(comb, `schema ${i} has a combined function`)
  const interp = new Validator(schema, { engine: 'interpreter', richErrors: false })
  const lean = new Validator(schema, { richErrors: false })
  for (let k = 0; k < 400; k++) {
    const d = tree(0)
    const want = interp.validate(d)
    const got = comb(d)
    assert.strictEqual(got.valid, want.valid, `schema ${i} verdict on ${JSON.stringify(d)}`)
    if (!want.valid) {
      rejected++
      assert.strictEqual(shape(got.errors), shape(want.errors), `schema ${i} errors on ${JSON.stringify(d)}`)
      assert.strictEqual(shape(lean.validate(d).errors), shape(want.errors), `schema ${i} validate() errors on ${JSON.stringify(d)}`)
    }
    compared++
  }
}
assert.ok(rejected > 300, `expected many rejections, got ${rejected}`)
console.log(`ok: schemas that reach the root through a definition get the combined function, and agree with the interpreter (${compared} documents, ${rejected} rejected)`)
