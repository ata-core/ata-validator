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
const { compiledModuleFor, compiledEligible } = require('../build')
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
      const compiled = fromCompiled(load(src), schema)
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
fs.rmSync(dir, { recursive: true, force: true })

if (diffs.length) {
  console.log(`${diffs.length} of ${compared} differ. A sample:\n`)
  for (const d of diffs.slice(0, Number(process.env.SHOW) || 10)) console.log(d + '\n')
}
assert.strictEqual(diffs.length, 0, 'the compiled wrapper and the runtime disagree')
assert.ok(schemas > 500, `only ${schemas} schemas compared`)
console.log(`ok: fromCompiled answers as new Validator on ${compared} checks over ${schemas} schemas (${declined} declined as ineligible, ${unbuilt} left on the runtime because the emitter could not compile them or give their errors)`)
