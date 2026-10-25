'use strict'
// The generated code takes one of three forms by target engine (v8, jsc,
// jsc-aot: lib/js-compiler setTargetEngine). The forms differ in how a closed
// object's keys are counted and walked and in how the plain-object test
// reads the prototype; they must not differ in what they accept. Every group
// of the official suite (2020-12 and draft 7) is compiled in all three forms
// and run on every test, plus objects with another prototype, inherited keys
// and keys in another order, which is where the forms could drift apart.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { toStandaloneModule } = require('../lib/aot')
const { setTargetEngine, targetEngine } = require('../lib/js-compiler')

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', draft7: 'http://json-schema.org/draft-07/schema#' }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-engines-'))
let n = 0
const load = (src) => { const f = path.join(dir, `m${n++}.cjs`); fs.writeFileSync(f, src); return require(f) }
const withDialect = (s, uri) => (typeof s === 'object' && s !== null && !Array.isArray(s) && !('$schema' in s)) ? { ...s, $schema: uri } : s

// Documents the suite does not have: the same shape through other prototypes
// and other key orders.
function extraDocs (data) {
  const out = []
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data)
    const reversed = {}
    for (const k of keys.slice().reverse()) reversed[k] = data[k]
    out.push(reversed)
    const bare = Object.create(null)
    for (const k of keys) bare[k] = data[k]
    out.push(bare)
    const inherited = Object.create(keys.length ? { [keys[0]]: data[keys[0]] } : {})
    for (const k of keys.slice(1)) inherited[k] = data[k]
    out.push(inherited)
    class Shape {}
    const inst = new Shape()
    for (const k of keys) inst[k] = data[k]
    out.push(inst)
  }
  return out
}

const engines = ['v8', 'jsc', 'jsc-aot']
let groups = 0, compared = 0, unbuilt = 0
const diffs = []
const prev = targetEngine()
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const sdir = path.join(__dirname, 'suite/tests', dialect)
  for (const file of fs.readdirSync(sdir).filter((f) => f.endsWith('.json')).sort()) {
    for (const group of JSON.parse(fs.readFileSync(path.join(sdir, file), 'utf8'))) {
      groups++
      const mods = {}
      let ok = true
      for (const e of engines) {
        setTargetEngine(e)
        try {
          // A fresh schema object per engine: the compile cache is keyed by
          // content and engine, and the identity caches by object.
          const schema = withDialect(JSON.parse(JSON.stringify(group.schema)), uri)
          const src = toStandaloneModule(new Validator(schema, {}), { format: 'cjs' })
          if (!src) { ok = false; break }
          mods[e] = load(src)
        } catch { ok = false; break }
      }
      setTargetEngine(prev)
      if (!ok) { unbuilt++; continue }
      for (const t of group.tests) {
        const docs = [t.data, ...extraDocs(t.data)]
        for (let i = 0; i < docs.length; i++) {
          const answers = engines.map((e) => { const d = JSON.parse(JSON.stringify(docs[i] === undefined ? null : docs[i])); void d; try { return String(mods[e].isValid(docs[i])) + '/' + String(mods[e].validate(docs[i]).valid) } catch (err) { return 'throw:' + err.message } })
          compared++
          if (new Set(answers).size !== 1) diffs.push(`${dialect}/${file} :: ${group.description} :: ${t.description}${i ? ` (variant ${i})` : ''}: ${engines.map((e, j) => `${e}=${answers[j]}`).join(' ')}`)
        }
      }
    }
  }
}
setTargetEngine(prev)
fs.rmSync(dir, { recursive: true, force: true })
if (diffs.length) {
  console.error(diffs.slice(0, 20).join('\n'))
  assert.fail(`${diffs.length} answers differ between engine forms`)
}
assert.ok(compared > 4000, `compared ${compared}`)
// The jsc-aot form is in use where it should be: a closed, all-required object.
setTargetEngine('jsc-aot')
const closed = toStandaloneModule(new Validator({ type: 'object', required: ['a', 'b'], additionalProperties: false, properties: { a: { type: 'string' }, b: { type: 'integer' } } }, {}), { format: 'esm' })
setTargetEngine(prev)
assert.ok(/const _ks\d+=Object\.keys\(d\);if\(_ks\d+\.length!==2\)return false;if\(!\(_ks\d+\[0\]==="a"&&_ks\d+\[1\]==="b"\)\)/.test(closed), closed)
assert.throws(() => setTargetEngine('wasm'), /unknown target engine/)
console.log(`ok: three engine forms agree on ${compared} answers over ${groups} suite groups (${unbuilt} not built standalone)`)
