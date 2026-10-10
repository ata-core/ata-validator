'use strict'

// draft-06 is read through the draft-07 rules with `if`/`then`/`else` inert.
// Before, a draft-06 schema was read under 2020-12 and its tuple `items`,
// `additionalItems` and `dependencies` were not applied, so documents the
// schema rejects were accepted. Every engine and the compiled module must
// agree on each case below.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

const D6 = 'http://json-schema.org/draft-06/schema#'
const D7 = 'http://json-schema.org/draft-07/schema#'

const cases = [
  // tuple items with additionalItems: false
  { schema: { $schema: D6, items: [{ type: 'string' }, { type: 'integer' }], additionalItems: false }, data: ['a', 1], valid: true },
  { schema: { $schema: D6, items: [{ type: 'string' }, { type: 'integer' }], additionalItems: false }, data: ['a', 1, 'extra'], valid: false },
  { schema: { $schema: D6, items: [{ type: 'string' }, { type: 'integer' }] }, data: [1, 'a'], valid: false },
  // dependencies, both forms
  { schema: { $schema: D6, dependencies: { card: ['billing'] } }, data: { card: 1 }, valid: false },
  { schema: { $schema: D6, dependencies: { card: { required: ['cvv'] } } }, data: { card: 1, cvv: 2 }, valid: true },
  { schema: { $schema: D6, dependencies: { card: { required: ['cvv'] } } }, data: { card: 1 }, valid: false },
  // $ref siblings are ignored
  { schema: { $schema: D6, definitions: { s: { type: 'string' } }, properties: { a: { $ref: '#/definitions/s', maxLength: 1 } } }, data: { a: 'long' }, valid: true },
  // no conditional in draft-06; the same schema under draft-07 applies it
  { schema: { $schema: D6, if: { required: ['a'] }, then: { required: ['b'] } }, data: { a: 1 }, valid: true, unconstrained: true },
  { schema: { $schema: D7, if: { required: ['a'] }, then: { required: ['b'] } }, data: { a: 1 }, valid: false },
  { schema: { $schema: D6, properties: { x: { if: { type: 'string' }, else: false } } }, data: { x: 1 }, valid: true },
  // a reference to the draft-06 meta-schema resolves offline
  { schema: { $schema: D6, $ref: 'http://json-schema.org/draft-06/schema#' }, data: { type: 'string' }, valid: true, unconstrained: true },
  { schema: { $schema: D6, $ref: 'http://json-schema.org/draft-06/schema#' }, data: { type: 12 }, valid: false, unconstrained: true },
]

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-d6-'))
let n = 0
for (const c of cases) {
  const label = JSON.stringify(c.schema) + ' on ' + JSON.stringify(c.data)
  const codegen = new Validator(c.schema)
  const interp = new Validator(c.schema, { engine: 'interpreter' })
  assert.strictEqual(codegen.validate(c.data).valid, c.valid, 'codegen ' + label)
  assert.strictEqual(interp.validate(c.data).valid, c.valid, 'interpreter ' + label)
  assert.strictEqual(codegen.isValidObject(c.data), c.valid, 'isValidObject ' + label)
  assert.strictEqual(codegen.validateJSON(JSON.stringify(c.data)).valid, c.valid, 'validateJSON ' + label)
  // A schema the module emitter declines comes back as null, never as a
  // module that accepts everything. It declines a schema with no constraint
  // left (as it does `{}`) and a reference to a meta-schema; marked below.
  const src = toStandaloneModule(new Validator(c.schema), { format: 'cjs' })
  if (src === null) {
    assert.ok(c.unconstrained, 'module declined ' + label)
  } else {
    const file = path.join(dir, `m${n}.cjs`)
    fs.writeFileSync(file, src)
    assert.strictEqual(require(file).validate(c.data).valid, c.valid, 'compiled module ' + label)
  }
  n++
}

// The caller's schema is not changed by the normalization.
const own = { $schema: D6, if: { type: 'string' }, then: { minLength: 2 } }
new Validator(own).validate('a')
assert.deepStrictEqual(Object.keys(own), ['$schema', 'if', 'then'])

console.log(`draft-06: ${cases.length} cases agree on both engines, the text path and the compiled module`)
