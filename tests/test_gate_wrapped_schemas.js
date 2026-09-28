'use strict'

// The code generator's safety gate must hold wherever a schema sits. It used
// to stop at the first node with `additionalProperties: true` and call the
// whole subtree safe, so a construct the generator cannot express, nested
// under such a node, was dropped instead of sent to the interpreted engine:
// `{ properties: { f: { additionalProperties: false } }, additionalProperties: true }`
// accepted `{ f: { x: 1 } }` from 1.0.0 to 1.35.0. SchemaStore's treefmt
// schema, run against its own invalid sample, is where it showed.
//
// Every official suite case is checked again with its schema placed under a
// property of a permissive parent, and the default engine must answer as the
// interpreted engine does: verdict and errors.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { Validator } = require('..')

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  v1: 'https://json-schema.org/v1',
}
const shape = (r) => JSON.stringify(r.valid ? true : r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.message]))
const WRAPS = [
  (s, uri) => ({ $schema: uri, type: 'object', properties: { x: s }, additionalProperties: true }),
  (s, uri) => ({ $schema: uri, type: 'object', patternProperties: { '^x$': s }, additionalProperties: true }),
  (s, uri) => ({ $schema: uri, type: 'array', items: { type: 'object', properties: { x: s }, additionalProperties: true } }),
]

let compared = 0
const diffs = []
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite/tests', dialect)
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      // A schema with ids or anchors of its own means something else once it
      // is not the root; those cases stay with the root-level suite.
      const text = JSON.stringify(group.schema)
      if (/"\$(id|anchor|dynamicAnchor|recursiveAnchor|ref|dynamicRef|recursiveRef)"/.test(text)) continue
      WRAPS.forEach((wrap, w) => {
        const schema = wrap(group.schema, uri)
        let fast, interp
        try { fast = new Validator(schema, { useDefaults: false }); interp = new Validator(schema, { engine: 'interpreter', useDefaults: false }) } catch { return }
        for (const t of group.tests) {
          const doc = w === 2 ? [{ x: t.data }] : { x: t.data }
          const a = shape(fast.validate(structuredClone(doc)))
          const b = shape(interp.validate(structuredClone(doc)))
          compared++
          if (a !== b) diffs.push(`${dialect}/${file} :: ${group.description} :: ${t.description} (wrap ${w})\n    default     ${a.slice(0, 200)}\n    interpreter ${b.slice(0, 200)}`)
        }
      })
    }
  }
}
if (diffs.length) { console.log(`${diffs.length} of ${compared} differ:\n`); for (const d of diffs.slice(0, 10)) console.log(d + '\n') }
assert.strictEqual(diffs.length, 0, 'a wrapped schema is answered differently by the default engine')
assert.ok(compared > 5000, `compared ${compared}`)
console.log(`ok: wrapped under a permissive parent, ${compared} suite cases answer the same on both engines`)
