'use strict'

// fromCompiled() around a compiled module must answer as `new Validator(schema)`
// does with default options: the same verdicts, the same `data`, and the same
// errors, field by field and in order, from validate(), isValidObject(),
// validateJSON() and isValidJSON(). A bundler plugin puts it in place of the
// runtime for every schema compiledEligible() accepts, so any difference here
// is a difference a user would see after turning the plugin on. Every case of
// the official suite in three dialects goes through both. The test reports how
// many schemas it compared and how many it declined.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { compiledModuleFor, compiledEligible, compiledSchemaFor } = require('../build')
const { fromCompiled } = require('../lib/compiled')

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  v1: 'https://json-schema.org/v1',
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-compiled-'))
let n = 0
function load (src) {
  const f = path.join(dir, `m${n++}.cjs`)
  fs.writeFileSync(f, src)
  return require(f)
}

const show = (r) => JSON.stringify(r)
let schemas = 0, declined = 0, unbuilt = 0, compared = 0
const diffs = []
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const sdir = path.join(__dirname, 'suite/tests', dialect)
  for (const file of fs.readdirSync(sdir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(sdir, file), 'utf8'))) {
      const schema = typeof group.schema === 'object' && group.schema !== null && !('$schema' in group.schema)
        ? { ...group.schema, $schema: uri }
        : group.schema
      if (!compiledEligible(schema)) { declined++; continue }
      const src = compiledModuleFor(schema, { format: 'cjs' })
      if (!src) { unbuilt++; continue }
      schemas++
      const runtime = new Validator(schema)
      const compiled = fromCompiled(load(src), compiledSchemaFor(schema))
      for (const t of group.tests) {
        const text = JSON.stringify(t.data)
        const checks = [
          ['validate', () => show(runtime.validate(JSON.parse(text))), () => show(compiled.validate(JSON.parse(text)))],
          ['validate.data', () => { const d = JSON.parse(text); const r = runtime.validate(d); return r.valid ? String(r.data === d) : '-' }, () => { const d = JSON.parse(text); const r = compiled.validate(d); return r.valid ? String(r.data === d) : '-' }],
          ['isValidObject', () => String(runtime.isValidObject(JSON.parse(text))), () => String(compiled.isValidObject(JSON.parse(text)))],
          ['validateJSON', () => show(runtime.validateJSON(text)), () => show(compiled.validateJSON(text))],
          ['isValidJSON', () => String(runtime.isValidJSON(text)), () => String(compiled.isValidJSON(text))],
        ]
        for (const [name, a, b] of checks) {
          compared++
          const want = a(), got = b()
          if (want !== got) diffs.push(`${dialect}/${file} :: ${group.description} :: ${t.description} :: ${name}\n    runtime  ${want.slice(0, 300)}\n    compiled ${got.slice(0, 300)}`)
        }
      }
    }
  }
}
// The suite has few defaults below the top level; seeded nested schemas with
// defaults at every depth, as a default Validator fills them.
{
  let x = 0xdef4
  const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k }
  const pick = (a) => a[rnd(a.length)]
  const node = (depth) => {
    const properties = {}
    for (const k of ['a', 'b', 'c']) {
      if (rnd(3) === 0) continue
      if (depth > 0 && rnd(2) === 0) properties[k] = node(depth - 1)
      else {
        const leaf = pick([{ type: 'integer', minimum: 0 }, { type: 'string', minLength: 2 }, { type: 'boolean' }])
        if (rnd(2) === 0) leaf.default = pick([1, -1, 'xy', 'z', true])
        properties[k] = leaf
      }
    }
    const s = { type: 'object', properties }
    if (rnd(3) === 0) s.default = {}
    return s
  }
  const docFor = (s, depth) => {
    const o = {}
    for (const [k, p] of Object.entries(s.properties || {})) {
      if (rnd(3) === 0) continue
      o[k] = p.properties && depth > 0 ? docFor(p, depth - 1) : pick([5, 'ab', true, 'q', -2, null])
    }
    return o
  }
  for (let i = 0; i < 150; i++) {
    const schema = node(3)
    const src = compiledModuleFor(schema, { format: 'cjs' })
    if (!src) { unbuilt++; continue }
    schemas++
    const mod = load(src)
    const normalized = compiledSchemaFor(schema)
    // With defaults, and with `useDefaults: false`, the one option the wrapper
    // takes: the input is then left as it is, on both sides.
    for (const opts of [undefined, { useDefaults: false }]) {
      const runtime = new Validator(schema, opts)
      const compiled = fromCompiled(mod, normalized, opts)
      const label = opts ? 'useDefaults: false' : 'nested defaults'
      for (let j = 0; j < 5; j++) {
        const text = JSON.stringify(docFor(schema, 3))
        for (const [name, a, b] of [
          ['validate', () => show(runtime.validate(JSON.parse(text))), () => show(compiled.validate(JSON.parse(text)))],
          ['validate, input after', () => { const d = JSON.parse(text); runtime.validate(d); return JSON.stringify(d) }, () => { const d = JSON.parse(text); compiled.validate(d); return JSON.stringify(d) }],
          ['isValidObject', () => String(runtime.isValidObject(JSON.parse(text))), () => String(compiled.isValidObject(JSON.parse(text)))],
          ['validateJSON', () => show(runtime.validateJSON(text)), () => show(compiled.validateJSON(text))],
          ['isValidJSON', () => String(runtime.isValidJSON(text)), () => String(compiled.isValidJSON(text))],
        ]) {
          compared++
          const want = a(), got = b()
          if (want !== got) diffs.push(`${label} ${JSON.stringify(schema).slice(0, 200)} on ${text} :: ${name}\n    runtime  ${want.slice(0, 300)}\n    compiled ${got.slice(0, 300)}`)
        }
      }
    }
  }
}
// Options the wrapper does not reproduce are refused, not ignored.
{
  const src = compiledModuleFor({ type: 'string' }, { format: 'cjs' })
  const mod = load(src)
  for (const opts of [{ coerceTypes: true }, { removeAdditional: true }, { useDefaults: false, allErrors: true }, null, 'x']) {
    assert.throws(() => fromCompiled(mod, { type: 'string' }, opts), TypeError, JSON.stringify(opts))
  }
}
fs.rmSync(dir, { recursive: true, force: true })

if (diffs.length) {
  console.log(`${diffs.length} of ${compared} differ. A sample:\n`)
  for (const d of diffs.slice(0, Number(process.env.SHOW) || 10)) console.log(d + '\n')
}
assert.strictEqual(diffs.length, 0, 'the compiled wrapper and the runtime disagree')
assert.ok(schemas > 500, `only ${schemas} schemas compared`)
console.log(`ok: fromCompiled answers as new Validator on ${compared} checks over ${schemas} schemas (${declined} declined as ineligible, ${unbuilt} left on the runtime because the emitter could not compile them or give their errors)`)
