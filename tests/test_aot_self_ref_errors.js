'use strict'

// A standalone module for a schema with `$ref: "#"` anywhere in it reports
// the real errors. The error generator declined the self-reference, so the
// module reported every failure as the single ATA9000 stub while the runtime
// reported the errors themselves; a SchemaStore component schema in the
// cold-start harness was such a case. Held to the runtime's validate() on
// keyword, instance path and schema path, through nested references and on a
// document that points back at itself.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

const tree = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    children: { type: 'array', items: { $ref: '#' } },
    meta: { type: 'object', properties: { parent: { $ref: '#' } }, additionalProperties: false },
  },
  required: ['name'],
  additionalProperties: false,
}
const docs = [
  { name: 'root' },
  { name: '' },
  { name: 'a', children: [{ name: 'b' }, { name: 2 }, { children: [] }] },
  { name: 'a', children: [{ name: 'b', children: [{ name: 'c', extra: 1 }] }] },
  { name: 'a', meta: { parent: { name: 'p', children: [{}] }, other: 1 } },
  { name: 'a', children: 'nope' },
  [],
]

const warnings = []
const src = toStandaloneModule(tree, { format: 'cjs', onWarning: (m, info) => warnings.push(info && info.kind) })
assert.ok(src, 'the module compiles')
assert.deepStrictEqual(warnings, [], 'the error function is generated, not the stub')
assert.ok(!/\brequire\(/.test(src), 'the module imports nothing')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-self-ref-'))
const file = path.join(dir, 'tree.cjs')
fs.writeFileSync(file, src)
const mod = require(file)
const rt = new Validator(tree, { richErrors: false, useDefaults: false })
// The runtime hands errors out in schema order; a module reports them as its
// checks run. Compared as sets.
const shape = (r) => r.valid ? 'valid' : r.errors.map((e) => `${e.keyword} ${e.instancePath} ${e.schemaPath}`).sort()
for (let i = 0; i < 100; i++) for (const d of docs) { mod.validate(d); rt.validate(d).errors }
let rejected = 0
for (const d of docs) {
  const a = shape(mod.validate(d)), b = shape(rt.validate(d))
  assert.deepStrictEqual(a, b, `module and runtime agree on ${JSON.stringify(d)}`)
  assert.strictEqual(mod.isValid(d), b === 'valid')
  if (b !== 'valid') { rejected++; assert.ok(!JSON.stringify(mod.validate(d).errors).includes('ATA9000'), 'no stub error') }
}
assert.ok(rejected >= 5)
// A document that points back at itself is rejected the same way, not a stack overflow.
const loop = { name: 'x', children: [] }
loop.children.push(loop)
const a = shape(mod.validate(loop)), b = shape(rt.validate(loop))
assert.deepStrictEqual(a, b, 'cyclic document')
fs.rmSync(dir, { recursive: true, force: true })
console.log(`ok: a standalone module for a schema with $ref "#" reports the runtime's errors (${docs.length + 1} documents, ${rejected + 1} rejected)`)
