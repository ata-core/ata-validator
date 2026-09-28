'use strict'

// A pattern error quotes the pattern as the schema wrote it, on every engine.
// The generated code put the pattern into a single-quoted string literal, so
// the parser consumed its backslashes: `\.litertlm$` was reported as
// `.litertlm$`, and `a\nb` as a line break. Found by running SchemaStore's
// schemas against their own sample documents on both engines.

const assert = require('assert')
const { Validator } = require('..')

const PATTERNS = ['\\.litertlm$', 'a\\nb', "it's", '\\d+\\\\x', '^\\$\\{[a-z]+\\}$', '"quoted"', '\\u00e9']
let n = 0
for (const pattern of PATTERNS) {
  const schema = { type: 'object', properties: { p: { type: 'string', pattern } }, propertyNames: { pattern: '^(p|' + pattern + ')$' } }
  const doc = { p: 'zz', other: 1 }
  const messages = (o) => new Validator(schema, o).validate(structuredClone(doc)).errors.map((e) => e.message)
  const fast = messages(), interp = messages({ engine: 'interpreter' })
  assert.deepStrictEqual(fast, interp, `messages differ for ${JSON.stringify(pattern)}`)
  assert.ok(fast.some((m) => m === `must match pattern "${pattern}"`), `the pattern is quoted as written: ${JSON.stringify(fast)}`)
  n++
}
console.log(`ok: pattern messages quote the pattern as written on both engines (${n} patterns)`)
