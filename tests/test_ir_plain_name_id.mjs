// A fragment-only `$id` (`"$id": "#foo"`) is draft-07's spelling of an
// anchor. In a schema that declares no dialect ata-validator/ir did not read
// it as one, so a module written from such a schema refused every document
// with ATA5001 where the Validator accepted the valid ones. The suite's
// "Location-independent identifier" group in draft-07 and draft-06 is this
// schema; the suite runs here set a dialect for it, and a build plugin that
// passes the schema as written does not.
//
// Normalization now folds it into `$anchor` in every dialect
// (lib/draft7.js), the one both sides read. Each schema is held to the
// Validator's answers, and tests/test_plain_name_id.js holds the Validator's.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { compileClosures, specialize } from '../lib/ir/index.mjs'
const { Validator } = createRequire(import.meta.url)('..')
const kernels = new URL('../lib/kernels/index.mjs', import.meta.url).href

const int = { type: 'integer' }
const cases = [
  { allOf: [{ $ref: '#foo' }], definitions: { A: { $id: '#foo', ...int } } },
  { allOf: [{ $ref: '#foo' }], $defs: { A: { $id: '#foo', ...int } } },
  { $id: 'http://example.test/root.json', allOf: [{ $ref: '#foo' }], $defs: { A: { $id: '#foo', ...int } } },
  { $schema: 'https://json-schema.org/draft/2020-12/schema', allOf: [{ $ref: '#foo' }], $defs: { A: { $id: '#foo', ...int } } },
  { $schema: 'http://json-schema.org/draft-07/schema#', allOf: [{ $ref: '#foo' }], definitions: { A: { $id: '#foo', ...int } } },
  { properties: { a: { $ref: '#foo' } }, $defs: { A: { $id: '#foo', ...int } } },
  // The later of two declarations of one name is the one a reference reaches.
  { allOf: [{ $ref: '#foo' }], $defs: { A: { $id: '#foo', ...int }, B: { $anchor: 'foo', type: 'string' } } },
  { allOf: [{ $ref: '#foo' }], $defs: { B: { $anchor: 'foo', type: 'string' }, A: { $id: '#foo', ...int } } },
  // Deeper than the root's definitions, and in another resource.
  { allOf: [{ $ref: '#foo' }], properties: { a: { $id: '#foo', ...int } } },
  { allOf: [{ $ref: '#foo' }], $defs: { A: { $defs: { B: { $id: '#foo', ...int } } } } },
  { $id: 'http://example.test/root.json', allOf: [{ $ref: 'other.json#foo' }], $defs: { O: { $id: 'other.json', $defs: { A: { $id: '#foo', ...int } } } } },
]
const docs = [1, 'a', 1.5, null, { a: 1 }, { a: 'x' }]
let n = 0; let accepted = 0
for (const schema of cases) {
  const want = new Validator(schema)
  const closures = compileClosures(schema)
  const src = specialize(schema).replace(/(['"])ata-validator\/kernels\1/g, `'${kernels}'`)
  const mod = await import('data:text/javascript,' + encodeURIComponent(src))
  const fn = mod.isValid || mod.default
  for (const d of docs) {
    const w = want.validate(structuredClone(d))
    if (w.valid) accepted++
    assert.strictEqual(closures.isValid(structuredClone(d)), w.valid, `closures ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    const c = closures.validate(structuredClone(d))
    assert.strictEqual(c.valid, w.valid, `closures validate() ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    if (!w.valid) assert.strictEqual(c.errors[0].code, w.errors[0].code, `closures error code ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    const r = fn(structuredClone(d))
    assert.strictEqual(typeof r === 'object' ? r.valid : r, w.valid, `specialized module ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    n++
  }
}
// The cases are not all refusals: the Validator accepts some documents.
assert.ok(accepted > 0 && accepted < n, 'the engine accepts some documents and refuses others')
console.log(`ok: ir reads a fragment-only $id as the engine does, ${cases.length} schemas, ${n} documents, ${accepted} accepted`)
