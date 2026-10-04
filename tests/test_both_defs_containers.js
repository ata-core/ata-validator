'use strict'

// A schema with both `$defs` and `definitions` at the root, the same name
// under each with different schemas. The code generators looked definitions
// up by name in one table and read `#/definitions/x` as `$defs/x`, so the
// default engine rejected what the schema allows and accepted what it
// rejects. Every engine and every read must resolve the pointer as written.

const assert = require('node:assert')
const { Validator } = require('..')

const cases = [
  ['http://json-schema.org/draft-07/schema#', '#/definitions/x', 1, 'a'],
  ['http://json-schema.org/draft-07/schema#', '#/$defs/x', 'a', 1],
  ['https://json-schema.org/draft/2020-12/schema', '#/definitions/x', 1, 'a'],
  ['https://json-schema.org/draft/2020-12/schema', '#/$defs/x', 'a', 1],
]
let compared = 0
for (const [dialect, ref, good, bad] of cases) {
  const schema = {
    $schema: dialect,
    type: 'object',
    properties: { a: { $ref: ref } },
    definitions: { x: { type: 'integer' } },
    $defs: { x: { type: 'string' } },
  }
  for (const engine of [undefined, 'interpreter']) {
    const v = new Validator(schema, engine ? { engine } : {})
    for (const [value, want] of [[good, true], [bad, false]]) {
      const doc = { a: value }
      const text = JSON.stringify(doc)
      const label = `${dialect} ${ref} engine=${engine || 'default'} a=${JSON.stringify(value)}`
      for (let i = 0; i < 70; i++) {
        assert.strictEqual(v.validate(doc).valid, want, 'validate ' + label)
        assert.strictEqual(v.isValidObject(doc), want, 'isValidObject ' + label)
        assert.strictEqual(v.isValidJSON(text), want, 'isValidJSON ' + label)
        assert.strictEqual(v.validateJSON(text).valid, want, 'validateJSON ' + label)
      }
      compared++
    }
  }
}
console.log(`ok: a pointer into definitions or $defs resolves as written when both exist (${compared} cases, every engine and read)`)
