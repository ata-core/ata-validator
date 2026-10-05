'use strict'

// Patterns with Unicode property escapes (\p{L}, \P{L}, \p{Lu}) compile into
// generated code with the unicode flag, as the interpreter compiles them.
// They used to send the whole schema to the interpreter. Every read path is
// compared with the interpreter, the text path and the standalone module too,
// on letters from outside ASCII.

const assert = require('node:assert')
const { Validator } = require('..')
const { toStandaloneModule } = require('../lib/aot.js')

const schemas = [
  [{ type: 'string', pattern: '^\\p{L}+$' }, ['abc', 'çğü', '123', '', 'a1']],
  [{ type: 'string', pattern: '\\P{L}' }, ['abc', 'a1', '!']],
  [{ type: 'object', properties: { n: { type: 'string', pattern: '^\\p{Lu}\\p{Ll}*$' } }, patternProperties: { '^\\p{Lu}': { type: 'integer' } }, propertyNames: { pattern: '^\\p{L}' } },
    [{ n: 'Ömer' }, { n: 'ömer' }, { Ab: 1 }, { Ab: 'x' }, { '1x': 1 }, { é: true }]],
]
let compared = 0
for (const [schema, docs] of schemas) {
  for (const richErrors of [false, true]) {
    const a = new Validator(schema, { richErrors })
    const b = new Validator(schema, { richErrors, engine: 'interpreter' })
    assert.strictEqual(a.engine(), 'codegen', `generated for ${JSON.stringify(schema)}`)
    for (const d of docs) {
      for (let r = 0; r < 80; r++) { const x = a.validate(d); if (!x.valid) void x.errors }
      const ra = a.validate(d), rb = b.validate(d)
      assert.strictEqual(ra.valid, rb.valid, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
      assert.strictEqual(JSON.stringify((ra.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath])), JSON.stringify((rb.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath])))
      for (let r = 0; r < 70; r++) a.isValidJSON(JSON.stringify(d))
      assert.strictEqual(a.isValidJSON(JSON.stringify(d)), rb.valid, `text path on ${JSON.stringify(d)}`)
      compared++
    }
  }
  const src = toStandaloneModule(new Validator(schema), { format: 'cjs' })
  assert.ok(src, 'a standalone module is emitted')
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, require)
  const it = new Validator(schema, { engine: 'interpreter' })
  for (const d of docs) assert.strictEqual(m.exports.isValid(d), it.validate(d).valid, `standalone on ${JSON.stringify(d)}`)
}
console.log(`ok: Unicode property escapes in patterns compile and answer as the interpreter does, on every path (${compared} documents)`)
