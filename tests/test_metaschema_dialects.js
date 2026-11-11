'use strict'

// The vendored draft-07, draft-06 and draft-04 meta-schemas are read by the
// rules of their own dialect. They were kept as fetched and read under
// 2020-12, where draft-04's `dependencies` and boolean `exclusiveMinimum`
// mean nothing: `{ multipleOf: 0 }` and `{ exclusiveMaximum: true }` were
// accepted as valid draft-04 schemas. Found by scripts/gate.js, where the IR
// (which normalizes them) rejected what the Validator accepted.

const assert = require('node:assert')
const { Validator } = require('..')

const D4 = 'http://json-schema.org/draft-04/schema#'
const D6 = 'http://json-schema.org/draft-06/schema#'
const D7 = 'http://json-schema.org/draft-07/schema#'

const cases = {
  [D4]: [
    [{}, true], [{ type: 'object', properties: { a: { type: 'string' } }, definitions: { x: {} } }, true],
    [{ multipleOf: 0 }, false], [{ multipleOf: 2 }, true],
    [{ exclusiveMaximum: true }, false], [{ exclusiveMinimum: true }, false],
    [{ maximum: 3, exclusiveMaximum: true }, true], [{ minimum: 1, exclusiveMinimum: true }, true],
    [{ required: [] }, false], [{ required: ['a'] }, true], [{ type: 1 }, false],
    [{ dependencies: { a: ['b'], c: {} } }, true], [{ dependencies: { a: [] } }, false],
  ],
  [D6]: [
    [{}, true], [{ multipleOf: 0 }, false], [{ exclusiveMaximum: true }, false], [{ exclusiveMaximum: 3 }, true],
    [{ required: [] }, true], [{ type: 1 }, false], [{ items: [{}, {}] }, true], [{ dependencies: { a: ['b'], c: {} } }, true],
  ],
  [D7]: [
    [{}, true], [{ multipleOf: 0 }, false], [{ exclusiveMaximum: true }, false], [{ exclusiveMaximum: 3 }, true],
    [{ required: [] }, true], [{ type: 1 }, false], [{ if: {}, then: 1 }, false], [{ dependencies: { a: ['b'], c: {} } }, true],
  ],
}

let checked = 0
for (const [meta, list] of Object.entries(cases)) {
  for (const options of [{}, { useDefaults: false }, { engine: 'interpreter' }, { engine: 'interpreter', useDefaults: false }]) {
    for (const schema of [{ $schema: meta, $ref: meta }, { $ref: meta }]) {
      const v = new Validator(schema, options)
      for (const [doc, want] of list) {
        const where = `${meta} ${JSON.stringify(options)} ${JSON.stringify(doc)}`
        assert.strictEqual(v.validate(JSON.parse(JSON.stringify(doc))).valid, want, where)
        assert.strictEqual(v.isValidObject(JSON.parse(JSON.stringify(doc))), want, where + ': isValidObject')
        checked++
      }
    }
  }
}

// With defaults on, a draft-04 schema without bounds is still a valid one:
// the two defaults that contradict the meta-schema's own rule are not filled.
const d = { type: 'string' }
assert.strictEqual(new Validator({ $schema: D4, $ref: D4 }).validate(d).valid, true)
assert.ok(!('exclusiveMaximum' in d) && !('exclusiveMinimum' in d))
assert.deepStrictEqual(d.definitions, {})

console.log(`test_metaschema_dialects: ${checked} checks`)
