'use strict'
// fromCompiledPlain() around a module written with `plainErrors: true` answers
// as `new Validator(schema, { richErrors: false })`: the same verdicts, the
// same error objects in the same order, defaults filled the same way, over
// the official suite in five dialects. And the wrapper carries no error
// pipeline: bundled for a browser it holds neither the rejection classes nor
// the enrichment.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { compiledModuleFor, compiledSchemaFor, compiledEligible } = require('../build')
const { fromCompiledPlain } = require('../lib/compiled-plain')
const suite = require('./suite-loader')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-plain-'))
let n = 0
const load = (src) => { const f = path.join(dir, `m${n++}.cjs`); fs.writeFileSync(f, src); return require(f) }
const show = (r) => JSON.stringify(r.valid ? { valid: true } : { valid: false, errors: r.errors })

let compared = 0, schemas = 0
const diffs = []
for (const dialect of ['draft2020-12', 'draft2019-09', 'draft7', 'draft6', 'draft4']) {
  for (const { file, cases } of suite.files(dialect)) {
    for (const group of cases) {
      const schema = group.schema
      if (!compiledEligible(schema)) continue
      const src = compiledModuleFor(schema, { format: 'cjs', plainErrors: true })
      if (!src) continue
      schemas++
      const runtime = new Validator(schema, { richErrors: false })
      const plain = fromCompiledPlain(load(src), compiledSchemaFor(schema), { richErrors: false })
      for (const t of group.tests) {
        const text = JSON.stringify(t.data)
        for (const [name, a, b] of [
          ['validate', () => show(runtime.validate(JSON.parse(text))), () => show(plain.validate(JSON.parse(text)))],
          ['isValidObject', () => String(runtime.isValidObject(JSON.parse(text))), () => String(plain.isValidObject(JSON.parse(text)))],
          ['input after', () => { const d = JSON.parse(text); runtime.validate(d); return JSON.stringify(d) }, () => { const d = JSON.parse(text); plain.validate(d); return JSON.stringify(d) }],
          ['~standard', () => JSON.stringify(runtime['~standard'].validate(JSON.parse(text))), () => JSON.stringify(plain['~standard'].validate(JSON.parse(text)))],
        ]) {
          compared++
          const want = a(), got = b()
          if (want !== got) diffs.push(`${dialect}/${file} :: ${group.description} :: ${t.description} :: ${name}\n    runtime ${want.slice(0, 300)}\n    plain   ${got.slice(0, 300)}`)
        }
      }
    }
  }
}
fs.rmSync(dir, { recursive: true, force: true })
if (diffs.length) { console.error(diffs.slice(0, 10).join('\n')); assert.fail(`${diffs.length} answers differ`) }
assert.ok(schemas > 1000 && compared > 15000, `${schemas} schemas, ${compared} answers`)
assert.throws(() => fromCompiledPlain({ isValid: () => true, validate: () => ({ valid: true }) }, {}, { richErrors: true }), TypeError)

// What a browser bundle of it holds.
const esbuild = require('esbuild')
const r = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'compiled-plain.mjs')], bundle: true, minify: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'error' })
const inputs = Object.keys(Object.values(r.metafile.outputs)[0].inputs)
for (const m of ['rejections', 'enrich-error', 'suggestions', 'schema-order', 'data-position-cache', 'defaults']) {
  assert.ok(!inputs.some((f) => f.endsWith(`/lib/${m}.js`)), `the plain wrapper's bundle holds lib/${m}.js`)
}
console.log(`ok: fromCompiledPlain answers as richErrors: false on ${compared} answers over ${schemas} suite schemas; its bundle has no error pipeline`)
