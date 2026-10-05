'use strict'

// `$dynamicRef` compiles. The code generators never read the keyword: a
// schema that uses it is unrolled by dynamic scope first (expandDynamicScopes
// in lib/js-compiler.js), one copy per node and scope, every reference a
// plain local one to the copy its scope selects. Held here to the interpreted
// engine, which resolves the keyword the way the specification says, on every
// reference group of the Draft 2020-12 suite, with their documents and
// mutated copies, through validate(), isValidObject() and validateJSON(); the
// unrolled schema is checked for what it must not contain; and the 2020-12
// meta-schema, the schema most people validate against through this keyword,
// must run on generated code.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { Validator } = require('..')
const jc = require('../lib/js-compiler')

const suite = path.join(__dirname, 'suite')
const remotes = {}
;(function collect (dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, prefix + e.name + '/')
    else if (e.name.endsWith('.json')) remotes['http://localhost:1234/' + prefix + e.name] = JSON.parse(fs.readFileSync(full, 'utf8'))
  }
})(path.join(suite, 'remotes'), '')

let seed = 3
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
// A copy with one value changed, so rejections are exercised beyond the
// suite's own invalid cases.
function mutate (doc) {
  const c = JSON.parse(JSON.stringify(doc))
  const slots = []
  const walk = (n, d) => { if (d > 5 || n === null || typeof n !== 'object') return; for (const k of Object.keys(n)) { slots.push([n, k]); walk(n[k], d + 1) } }
  walk(c, 0)
  if (slots.length === 0) return typeof c === 'number' ? 'x' : 1
  const [o, k] = slots[Math.floor(rnd() * slots.length)]
  const v = o[k]
  o[k] = typeof v === 'number' ? 'x' : typeof v === 'string' ? 7 : v === null ? [] : Array.isArray(v) ? {} : null
  return c
}

const shape = (errs) => (errs || []).map((e) => JSON.stringify([e.keyword, e.instancePath, e.schemaPath, e.params])).sort().join('\n')
const files = ['dynamicRef.json', 'defs.json', 'ref.json', 'refRemote.json', 'anchor.json', 'unevaluatedProperties.json', 'unevaluatedItems.json']
let groups = 0, onCodegen = 0, compared = 0, dynamicGroups = 0, dynamicOnCodegen = 0
for (const file of files) {
  for (const g of JSON.parse(fs.readFileSync(path.join(suite, 'tests', 'draft2020-12', file), 'utf8'))) {
    groups++
    const dynamic = JSON.stringify(g.schema).includes('$dynamicRef') || file === 'defs.json'
    if (dynamic) dynamicGroups++
    const gen = new Validator(g.schema, { schemas: remotes, assertFormat: false, richErrors: false })
    gen._coldCalls = 64
    const interp = new Validator(g.schema, { schemas: remotes, assertFormat: false, richErrors: false, engine: 'interpreter' })
    const docs = g.tests.map((t) => t.data)
    for (const d of g.tests.map((t) => t.data)) for (let i = 0; i < 3; i++) docs.push(mutate(d))
    for (let r = 0; r < 40; r++) for (const d of docs) void gen.validate(d).errors
    for (const [i, d] of docs.entries()) {
      const want = interp.validate(d)
      const text = JSON.stringify(d)
      const label = `${file} :: ${g.description} :: document ${i} ${text.slice(0, 80)}`
      const got = gen.validate(d)
      assert.strictEqual(got.valid, want.valid, 'validate, ' + label)
      if (!want.valid) assert.strictEqual(shape(got.errors), shape(want.errors), 'errors, ' + label)
      assert.strictEqual(gen.isValidObject(d), want.valid, 'isValidObject, ' + label)
      if (text !== undefined) assert.strictEqual(gen.validateJSON(text).valid, want.valid, 'validateJSON, ' + label)
      if (i < g.tests.length) assert.strictEqual(got.valid, g.tests[i].valid, 'the suite expects otherwise, ' + label)
      compared++
    }
    if (gen.engine() === 'codegen') { onCodegen++; if (dynamic) dynamicOnCodegen++ }
    if (file === 'defs.json') assert.strictEqual(gen.engine(), 'codegen', 'validation against the 2020-12 meta-schema runs on generated code')
  }
}
assert.ok(onCodegen >= 142, `expected at least 142 of the ${groups} groups on generated code, got ${onCodegen}`)
assert.ok(dynamicOnCodegen >= dynamicGroups - 1, `expected every dynamic group but the boolean-target one on generated code, got ${dynamicOnCodegen} of ${dynamicGroups}`)

// The unrolled schema: no dynamic keyword, no nested identifier, and nothing
// but the copies something refers to under $defs.
{
  const schemas = new Map(Object.entries(remotes))
  const tree = JSON.parse(fs.readFileSync(path.join(suite, 'tests', 'draft2020-12', 'dynamicRef.json'), 'utf8')).find((g) => g.description.startsWith('strict-tree')).schema
  const out = jc._expandDynamicScopes(tree, schemas)
  const text = JSON.stringify(out)
  assert.ok(out && !text.includes('"$dynamicRef"') && !text.includes('"$dynamicAnchor"') && !text.includes('"$anchor"'), text)
  assert.strictEqual((text.match(/"\$id"/g) || []).length, 1, 'only the root keeps its $id')
  for (const [name, def] of Object.entries(out.$defs)) assert.ok(name.startsWith('__ata_dyn_') && text.includes(`#/$defs/${name}"`), `${name} is a copy something refers to`)
  // A reference that does not resolve makes the whole rewrite give up.
  assert.strictEqual(jc._expandDynamicScopes({ $dynamicAnchor: 'a', properties: { x: { $dynamicRef: '#missing' } } }, null), null, 'an unresolvable reference declines')
}

// The v1 dialect drops bookending, which the unrolling assumes, and keeps the
// interpreted engine: the same answers either way.
{
  const v1 = { $schema: 'https://json-schema.org/v1', $dynamicAnchor: 'node', type: 'object', properties: { child: { $dynamicRef: '#node' } } }
  const v = new Validator(v1, { richErrors: false })
  for (let i = 0; i < 70; i++) v.validate({ child: {} })
  assert.notStrictEqual(v.engine(), 'codegen', 'v1 with $dynamicRef stays on the interpreted engine')
  assert.strictEqual(v.validate({ child: { child: 1 } }).valid, false)
  assert.strictEqual(v.validate({ child: { child: {} } }).valid, true)
}
console.log(`ok: $dynamicRef schemas unrolled by scope agree with the interpreter (${groups} groups, ${onCodegen} on generated code, ${compared} documents); the 2020-12 meta-schema runs on generated code`)
