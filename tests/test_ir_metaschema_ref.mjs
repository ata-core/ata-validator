// ata-validator/ir resolves a `$ref` to an official meta-schema from the
// vendored copies (lib/metaschemas.js) when the caller passes none, as the
// current engine does. It left the reference unresolved and refused every
// document with ATA5001: the suite's "valid definition schema" and "remote
// ref valid" in 2020-12 and draft-07 (found 2026-11-08 by the all-paths
// differential, which holds sixteen paths to the suite's answers).
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { compileClosures, specialize } from '../lib/ir/index.mjs'
const { Validator } = createRequire(import.meta.url)('..')
const kernels = new URL('../lib/kernels/index.mjs', import.meta.url).href

const cases = [
  { $ref: 'https://json-schema.org/draft/2020-12/schema' },
  { $ref: 'http://json-schema.org/draft-07/schema#' },
  { $schema: 'http://json-schema.org/draft-07/schema#', properties: { s: { $ref: 'http://json-schema.org/draft-07/schema#' } } },
]
const docs = [{ type: 'string' }, { type: 12 }, { minimum: 'x' }, { s: { type: 'integer' } }, { s: { type: [] } }, true, {}]
let n = 0
for (const schema of cases) {
  const want = new Validator(schema)
  const closures = compileClosures(schema)
  const src = specialize(schema).replace(/(['"])ata-validator\/kernels\1/g, `'${kernels}'`)
  const mod = await import('data:text/javascript,' + encodeURIComponent(src))
  const fn = mod.isValid || mod.default
  for (const d of docs) {
    // A fresh copy for each: the meta-schemas' defaults fill a document.
    const c = () => structuredClone(d)
    const w = want.validate(c()).valid
    assert.strictEqual(closures.isValid(c()), w, `closures ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    assert.strictEqual(closures.validate(c()).valid, w, `closures validate() ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    const r = fn(c())
    assert.strictEqual(typeof r === 'object' ? r.valid : r, w, `specialized module ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
    n++
  }
}
console.log(`ok: ir resolves meta-schema references as the engine does, ${cases.length} schemas, ${n} documents`)
