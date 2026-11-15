'use strict'
// A fragment-only `$id` (`"$id": "#node"`) is draft-07's spelling of an
// anchor. Under a declared draft-07 it was normalized into `$anchor`. In a
// schema that declares no dialect it was left as written, and the code
// generators read it as an anchor without being able to follow a cycle
// through it: where such a schema referred to itself they wrote nothing, so
// a recursive schema checked its first level (two at the root) and accepted
// whatever lay below. `{ "$ref": "#node", "definitions": { "N": { "$id":
// "#node", "properties": { "a": { "$ref": "#node" }, "n": { "type":
// "integer" } } } } }` accepted `{ "a": { "n": "x" } }` from validate(),
// isValidObject(), validateJSON() and isValidJSON() alike.
//
// Every form below is held to the answers the same schema gives when the
// anchor is spelled `$anchor`, and to the answers written beside the
// documents.
const assert = require('node:assert')
const { Validator } = require('..')

const node = (how) => ({ ...how, type: 'object', properties: { a: { $ref: '#node' }, n: { type: 'integer' } } })
const tree = (how) => ({ ...how, type: 'object', properties: { kids: { type: 'array', items: { $ref: '#node' } }, n: { type: 'integer' } } })
const shapes = {
  'the root': (body, how) => body(how),
  'a definition under $defs': (body, how) => ({ $ref: '#node', $defs: { N: body(how) } }),
  'a definition under definitions': (body, how) => ({ $ref: '#node', definitions: { N: body(how) } }),
  'a definition behind allOf': (body, how) => ({ allOf: [{ $ref: '#node' }], $defs: { N: body(how) } }),
  'a definition under a declared 2020-12': (body, how) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: '#node', $defs: { N: body(how) } }),
  'a definition under a declared draft-07': (body, how) => ({ $schema: 'http://json-schema.org/draft-07/schema#', allOf: [{ $ref: '#node' }], definitions: { N: body(how) } }),
  'a definition of a definition': (body, how) => ({ $ref: '#node', $defs: { Outer: { $defs: { N: body(how) } } } }),
  'a property': (body, how) => ({ type: 'object', properties: { t: body(how), u: { $ref: '#node' } } }),
}
const chain = [[{ n: 1 }, true], [{ n: 'x' }, false], [{ a: { n: 1 } }, true], [{ a: { n: 'x' } }, false], [{ a: { a: { n: 'x' } } }, false], [{ a: { a: { a: { n: 'x' } } } }, false], [{ a: { a: { a: { n: 2 } } } }, true]]
const kids = [[{ n: 1 }, true], [{ kids: [{ n: 1 }] }, true], [{ kids: [{ n: 'x' }] }, false], [{ kids: [{ kids: [{ n: 'x' }] }] }, false], [{ kids: [{ kids: [{ kids: [{ n: 'x' }] }] }] }, false], [{ kids: [{ kids: [{ kids: [{ n: 3 }] }] }] }, true]]
const methods = ['validate', 'isValidObject', 'validateJSON', 'isValidJSON']

let n = 0
for (const [where, shape] of Object.entries(shapes)) {
  for (const [body, docs] of [[node, chain], [tree, kids]]) {
    const byId = shape(body, { $id: '#node' })
    const byAnchor = shape(body, { $anchor: 'node' })
    for (const [d, want] of docs) {
      const doc = where === 'a property' ? { u: d } : d
      for (const m of methods) {
        const ask = (schema) => {
          // A validator for each call: the first call of a method decides
          // which engine answers it.
          const r = new Validator(structuredClone(schema))[m](m.endsWith('JSON') ? JSON.stringify(doc) : structuredClone(doc))
          return typeof r === 'object' ? r.valid : r
        }
        const label = `${m}() on ${JSON.stringify(doc)}, $id "#node" on ${where}`
        assert.strictEqual(ask(byId), want, label)
        assert.strictEqual(ask(byAnchor), want, label + ' (spelled $anchor)')
        n++
      }
    }
  }
}

// What a failed document is told is the same under either spelling.
{
  const errs = (how) => new Validator({ $ref: '#node', definitions: { N: node(how) } }).validate({ a: { a: { n: 'x' } } }).errors.map((e) => [e.instancePath, e.keyword, e.message])
  assert.deepStrictEqual(errs({ $id: '#node' }), errs({ $anchor: 'node' }))
  assert.strictEqual(errs({ $id: '#node' })[0][0], '/a/a/n')
}

// An `$id` that names a document, or one with a pointer for a fragment, is
// not an anchor and is left as it was.
{
  const v = new Validator({ $id: 'https://example.test/root.json', type: 'object', properties: { a: { $ref: '#/$defs/n' } }, $defs: { n: { $id: '#/$defs/n', type: 'integer' } } })
  assert.strictEqual(v.validate({ a: 1 }).valid, true)
  assert.strictEqual(v.validate({ a: 'x' }).valid, false)
}

// The caller's schema is not changed.
{
  const schema = { $ref: '#node', definitions: { N: node({ $id: '#node' }) } }
  const before = JSON.stringify(schema)
  new Validator(schema).validate({ a: { n: 1 } })
  assert.strictEqual(JSON.stringify(schema), before)
}

console.log(`ok: a fragment-only $id is an anchor in every dialect and a cycle through it is followed, ${n} checks`)
