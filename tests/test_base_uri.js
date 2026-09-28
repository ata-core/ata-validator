'use strict'

// `baseURI` is where the root schema was retrieved from; its relative
// references resolve against it when the schema declares no `$id` of its own.
// Draft-07 ignores an `$id` beside a root `$ref`, which is how SchemaStore
// writes its schemas, so without it a relative reference in them could not be
// resolved at all.

const assert = require('assert')
const { Validator } = require('..')

const registry = { 'https://example.org/b.json': { type: 'object', properties: { title: { type: 'string' } } } }
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://example.org/a.json',
  $ref: '#/definitions/W',
  definitions: { W: { type: 'object', properties: { s: { $ref: 'b.json' } } } },
}
const before = JSON.stringify(schema)

for (const engine of ['auto', 'interpreter']) {
  const without = new Validator(schema, { engine, schemas: registry })
  assert.strictEqual(without.validate({ s: { title: 'x' } }).valid, false, 'the draft-07 root has no base without baseURI')
  const withBase = new Validator(schema, { engine, schemas: registry, baseURI: 'https://example.org/a.json' })
  assert.strictEqual(withBase.validate({ s: { title: 'x' } }).valid, true, `${engine}: the relative reference resolves`)
  assert.strictEqual(withBase.validate({ s: { title: 1 } }).valid, false, `${engine}: and is enforced`)
}
// A different base resolves elsewhere, and the two do not share a compiled entry.
const other = new Validator(schema, { schemas: { 'https://other.org/b.json': { type: 'object', properties: { title: { type: 'number' } } } }, baseURI: 'https://other.org/a.json' })
assert.strictEqual(other.validate({ s: { title: 1 } }).valid, true)
assert.strictEqual(other.validate({ s: { title: 'x' } }).valid, false)
// A schema with an effective $id of its own keeps it.
const own = new Validator({ $id: 'https://example.org/c.json', properties: { s: { $ref: 'b.json' } } }, { schemas: registry, baseURI: 'https://elsewhere.org/c.json' })
assert.strictEqual(own.validate({ s: { title: 1 } }).valid, false)
assert.strictEqual(JSON.stringify(schema), before, 'the caller\'s schema is not modified')
console.log('ok: baseURI resolves a root schema\'s relative references, on both engines')
