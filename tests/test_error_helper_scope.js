'use strict'
// The error collector hoists a large property subschema, a shared or cyclic
// definition and the root behind `$ref: "#"` into helper functions whose
// parameter is named `d`, as the enclosing node's value is. The ordinary-
// object flag the enclosing node declares for its `d` (`_pkN`, from
// withPlain) is out of scope in such a helper. A helper that read it threw
// `ReferenceError: _pk0 is not defined` from validate() on 24 SchemaStore
// schemas (abc-supply-plan, appsettings, prometheus, webextension among them)
// where the flag was declared in another function, and where a flag of the
// same name happened to be in scope it would have read the wrong object's
// flag, which is the inherited-key divergence of 1.57.x in another form.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { compiledModuleFor } = require('../build')
const { Validator } = require('..')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-helper-scope-'))
let n = 0
const load = (src) => { const f = path.join(dir, `m${n++}.cjs`); fs.writeFileSync(f, src); return require(f) }

// Big enough to be hoisted into a helper (SPLIT_C_SCHEMA), walking its keys
// (a pattern property with the object closed, or additional properties as a
// schema) without declaring a flag of its own (no properties, no required),
// under a root that asks about presence and so declares one for its `d`.
const padding = 'described at some length so that the subschema is large enough to be hoisted into a helper function of its own. '.repeat(16)
const closed = { type: 'object', description: padding, patternProperties: { '^[a-z]+$': { type: 'string' } }, additionalProperties: false }
const open = { type: 'object', description: padding, additionalProperties: { type: 'string', maxLength: 3 } }
const cases = {
  'hoisted property, closed': { type: 'object', required: ['a'], properties: { a: { type: 'string' }, big: closed } },
  'hoisted property, open': { type: 'object', required: ['a'], properties: { a: { type: 'string' }, big: open } },
  'shared definition': { type: 'object', required: ['a'], properties: { a: { type: 'string' }, m: { $ref: '#/$defs/map' }, n: { $ref: '#/$defs/map' }, o: { $ref: '#/$defs/map' } }, $defs: { map: closed } },
  'recursive root': { type: 'object', required: ['a'], properties: { a: { type: 'string' }, big: closed, again: { $ref: '#' } } },
}

for (const [name, schema] of Object.entries(cases)) {
  const src = compiledModuleFor(schema, { format: 'cjs' })
  assert.ok(src, `${name}: a module is written`)
  // Every helper function is self-contained: each flag it reads, it declares.
  const helpers = src.split('\n').filter((l) => /function (_pe\d+|_defE\d+\w*)\(d,/.test(l))
  assert.ok(helpers.length > 0, `${name}: a helper function is emitted`)
  for (const h of helpers) {
    const read = new Set(h.match(/\b_pk\d+\b/g) || [])
    const declared = new Set((h.match(/(?:const|let|var) (_pk\d+)=/g) || []).map((m) => m.split(' ')[1].slice(0, -1)))
    for (const pk of read) assert.ok(declared.has(pk), `${name}: a helper reads ${pk}, a flag of the node that called it:\n${h.slice(0, 300)}`)
  }
  const m = load(src)
  const rt = new Validator(schema)
  const inner = { key: 'ok' }
  // Keys on the prototype are not the object's; a helper reading the root's
  // flag for its own `d` would walk them as if they were.
  const inherited = Object.create({ Z9: 'not a key of this object', long: 'toolong' })
  inherited.key = 'ok'
  const docs = [
    { a: 's', big: inner, m: inner, n: inner, o: inner },
    { a: 's', big: { key: 'ok', Z9: 2 }, m: { Z9: 2 }, n: inner, o: inner },
    { a: 's', big: inherited, m: inherited, n: inherited, o: inherited },
    { a: 's', big: { key: '' }, m: { key: 1 }, n: inner, o: inner, again: { a: 't', big: { Z9: 1 } } },
  ]
  for (const d of docs) {
    let got
    try { got = JSON.stringify([m.isValid(d), m.validate(d).valid, m.validate(d).errors.map((e) => e.keyword + '@' + e.instancePath)]) } catch (e) { assert.fail(`${name}: validate threw ${e.message}`) }
    const want = JSON.stringify([rt.isValidObject(d), rt.validate(d).valid, rt.validate(d).errors.map((e) => e.keyword + '@' + e.instancePath)])
    assert.strictEqual(got, want, `${name}: module and runtime disagree on ${JSON.stringify(d)}`)
  }
}
fs.rmSync(dir, { recursive: true, force: true })
console.log('ok: the error collector\'s helper functions read no flag of the node that called them')
