'use strict'

// Draft 2019-09 is read through a rewrite to the 2020-12 spelling: the array
// form of `items` with `additionalItems` becomes `prefixItems` and `items`,
// and `$recursiveRef`/`$recursiveAnchor` become `$dynamicRef`/`$dynamicAnchor`.
// Before, a 2019-09 schema was read as 2020-12 as written and documents its
// tuple and recursive rules reject were accepted. Every engine and the
// compiled module must agree.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

const D = 'https://json-schema.org/draft/2019-09/schema'

// An extensible tree: the base allows any extra keys on a node; the
// extension, through $recursiveRef, applies itself at every level.
const tree = {
  $schema: D, $id: 'https://example.com/strict-tree', $recursiveAnchor: true,
  $ref: 'tree', unevaluatedProperties: false,
  $defs: { tree: { $id: 'tree', $recursiveAnchor: true, type: 'object', properties: { data: true, children: { type: 'array', items: { $recursiveRef: '#' } } } } },
}
// Without the anchor on the outer root, $recursiveRef is a plain "#".
const plain = {
  $schema: D, $id: 'https://example.com/plain', $ref: 'tree',
  $defs: { tree: { $id: 'tree', $recursiveAnchor: true, type: 'object', properties: { children: { type: 'array', items: { $recursiveRef: '#' } } }, required: ['v'] } },
}

const cases = [
  { schema: { $schema: D, items: [{ type: 'string' }, { type: 'integer' }], additionalItems: false }, data: ['a', 1], valid: true },
  { schema: { $schema: D, items: [{ type: 'string' }, { type: 'integer' }], additionalItems: false }, data: ['a', 1, 2], valid: false },
  { schema: { $schema: D, items: [{ type: 'string' }], additionalItems: { type: 'boolean' } }, data: ['a', true, 3], valid: false },
  { schema: { $schema: D, items: { type: 'integer' }, additionalItems: false }, data: [1, 2, 3], valid: true },
  { schema: tree, data: { data: 1, children: [{ data: 2 }] }, valid: true },
  { schema: tree, data: { data: 1, children: [{ data: 2, extra: true }] }, valid: false },
  { schema: plain, data: { v: 1, children: [{ v: 2 }] }, valid: true },
  { schema: plain, data: { v: 1, children: [{}] }, valid: false },
  { schema: { $schema: D, $ref: 'https://json-schema.org/draft/2019-09/schema' }, data: { type: 'string' }, valid: true, mayDecline: true },
  { schema: { $schema: D, $ref: 'https://json-schema.org/draft/2019-09/schema' }, data: { type: 12 }, valid: false, mayDecline: true },
]

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-d2019-'))
let n = 0
for (const c of cases) {
  const label = JSON.stringify(c.schema).slice(0, 120) + ' on ' + JSON.stringify(c.data)
  const codegen = new Validator(c.schema)
  const interp = new Validator(c.schema, { engine: 'interpreter' })
  assert.strictEqual(codegen.validate(c.data).valid, c.valid, 'codegen ' + label)
  assert.strictEqual(interp.validate(c.data).valid, c.valid, 'interpreter ' + label)
  assert.strictEqual(codegen.isValidObject(c.data), c.valid, 'isValidObject ' + label)
  assert.strictEqual(codegen.validateJSON(JSON.stringify(c.data)).valid, c.valid, 'validateJSON ' + label)
  const src = toStandaloneModule(new Validator(c.schema), { format: 'cjs' })
  if (src === null) {
    assert.ok(c.mayDecline || c.schema === tree || c.schema === plain, 'module declined ' + label)
  } else {
    const file = path.join(dir, `m${n}.cjs`)
    fs.writeFileSync(file, src)
    assert.strictEqual(require(file).validate(c.data).valid, c.valid, 'compiled module ' + label)
  }
  n++
}

// The caller's schema is not changed by the rewrite.
const own = { $schema: D, items: [{ type: 'string' }], additionalItems: false }
new Validator(own).validate(['a'])
assert.deepStrictEqual(own, { $schema: D, items: [{ type: 'string' }], additionalItems: false })

console.log(`draft 2019-09: ${cases.length} cases agree on both engines, the text path and the compiled module`)
