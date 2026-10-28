'use strict'
// bareStandard (lib/compiled-standard.js, and compiled-standard.mjs as its own
// ES module) gives a validator handed to a Standard Schema consumer the
// `~standard` the runtime gives it, from a module written with plainErrors:
// the same issues (message and path) in the same order, the same input after
// defaults, and the same Standard JSON Schema; held on every case of the
// official suite the compiler takes. Its ES module bundle carries no error
// pipeline and no CommonJS interop.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const zlib = require('zlib')
const { Validator } = require('..')
const { compiledModuleFor, compiledEligible } = require('../build')
const { bareStandard } = require('../lib/compiled-standard')

;(async () => {
const esm = await import(pathToFileURL(path.join(__dirname, '..', 'compiled-standard.mjs')).href)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-std-'))
let n = 0
const load = (src) => { const f = path.join(dir, `m${n++}.cjs`); fs.writeFileSync(f, src); return require(f) }
const show = (r) => JSON.stringify('issues' in r ? r.issues.map((i) => [i.message, i.path.map((p) => p.key)]) : 'value')

let compared = 0, schemas = 0
const diffs = []
for (const [dialect, uri] of [['draft2020-12', 'https://json-schema.org/draft/2020-12/schema'], ['draft7', 'http://json-schema.org/draft-07/schema#']]) {
  const sdir = path.join(__dirname, 'suite/tests', dialect)
  for (const file of fs.readdirSync(sdir).filter((f) => f.endsWith('.json')).sort()) {
    for (const group of JSON.parse(fs.readFileSync(path.join(sdir, file), 'utf8'))) {
      const schema = typeof group.schema === 'object' && group.schema !== null && !('$schema' in group.schema) ? { ...group.schema, $schema: uri } : group.schema
      if (!compiledEligible(schema)) continue
      const src = compiledModuleFor(schema, { format: 'cjs', plainErrors: true })
      if (!src) continue
      schemas++
      const runtime = new Validator(schema)['~standard']
      const mod = load(src)
      // The schema as the caller wrote it: that is what `jsonSchema` hands out.
      const wrappers = [['cjs', bareStandard(mod, schema)['~standard']], ['esm', esm.bareStandard(mod, schema)['~standard']]]
      for (const t of group.tests) {
        const text = JSON.stringify(t.data)
        for (const [name, std] of wrappers) {
          compared++
          const want = show(runtime.validate(JSON.parse(text))), got = show(std.validate(JSON.parse(text)))
          if (want !== got) diffs.push(`${dialect}/${file} :: ${group.description} :: ${t.description} :: ${name}\n    runtime ${want.slice(0, 300)}\n    wrapper ${got.slice(0, 300)}`)
          // The input after: defaults filled in place, as the runtime fills them.
          const a = JSON.parse(text), b = JSON.parse(text)
          runtime.validate(a); std.validate(b)
          if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${dialect}/${file} :: ${group.description} :: input after, ${name}`)
        }
      }
      // Standard JSON Schema, for the schema's own dialect.
      const target = dialect === 'draft7' ? 'draft-07' : 'draft-2020-12'
      // A schema under another meta-schema makes both throw, with one message.
      const doc = (std) => { try { return JSON.stringify(std.jsonSchema.input({ target })) } catch (e) { return 'throws: ' + e.message } }
      for (const [name, std] of wrappers) {
        if (doc(runtime) !== doc(std)) diffs.push(`${dialect}/${file} :: ${group.description} :: jsonSchema, ${name}`)
      }
    }
  }
}
fs.rmSync(dir, { recursive: true, force: true })
if (diffs.length) { console.error(diffs.slice(0, 10).join('\n')); assert.fail(`${diffs.length} answers differ`) }
assert.ok(schemas > 500 && compared > 3000, `${schemas} schemas, ${compared} answers`)

for (const [name, std] of [['cjs', bareStandard], ['esm', esm.bareStandard]]) {
  const s = std({ isValid: () => true, validate: () => ({ valid: true }) }, { type: 'string' })['~standard']
  assert.strictEqual(s.version, 1); assert.strictEqual(s.vendor, 'ata-validator')
  assert.throws(() => s.jsonSchema.input({ target: 'draft-07' }), TypeError, `${name}: another dialect throws`)
}

// What a browser bundle of the ES module holds.
const esbuild = require('esbuild')
const r = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'compiled-standard.mjs')], bundle: true, minify: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'error' })
const inputs = Object.keys(Object.values(r.metafile.outputs)[0].inputs)
assert.deepStrictEqual(inputs.map((f) => path.basename(f)), ['compiled-standard.mjs'], 'the ES module entry must stand alone')
const size = zlib.gzipSync(r.outputFiles[0].contents, { level: 9 }).length
assert.ok(size <= 900, `the Standard wrapper bundles to ${size} bytes gzipped, over 900`)
console.log(`ok: bareStandard answers as the runtime's ~standard on ${compared} answers over ${schemas} suite schemas; its bundle is ${size} bytes gzipped and stands alone`)
})().catch((e) => { console.error(e); process.exit(1) })
