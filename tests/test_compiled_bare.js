'use strict'
// barePlain() and bareVerdict() from ata-validator/compiled-bare answer
// as `new Validator(schema, { richErrors: false })`: the same verdicts, the
// same error objects in the same order, defaults filled the same way, over
// the official suite in five dialects. And the bare wrappers carry nothing
// else: bundled for a browser they hold no error pipeline, no Standard
// Schema and no extension hook.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { compiledModuleFor, compiledSchemaFor, compiledEligible } = require('../build')
const { barePlain, bareVerdict } = require('../lib/compiled-bare')
const { bareRich } = require('../lib/compiled-bare-rich')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-plain-'))
let n = 0
const load = (src) => { const f = path.join(dir, `m${n++}.cjs`); fs.writeFileSync(f, src); return require(f) }
const show = (r) => JSON.stringify(r.valid ? { valid: true } : { valid: false, errors: r.errors })

const { pathToFileURL } = require('url')
const zlib = require('zlib')
;(async () => {
// The ES module entry is its own code, not a re-export: held to the same answers.
const esm = await import(pathToFileURL(path.join(__dirname, '..', 'compiled-bare.mjs')).href)
let compared = 0, schemas = 0
const diffs = []
for (const [dialect, uri] of [['draft2020-12', 'https://json-schema.org/draft/2020-12/schema'], ['draft2019-09', 'https://json-schema.org/draft/2019-09/schema'], ['draft7', 'http://json-schema.org/draft-07/schema#'], ['draft6', 'http://json-schema.org/draft-06/schema#'], ['draft4', 'http://json-schema.org/draft-04/schema#']]) {
  const sdir = path.join(__dirname, 'suite/tests', dialect)
  for (const file of fs.readdirSync(sdir).filter((f) => f.endsWith('.json')).sort()) {
    for (const group of JSON.parse(fs.readFileSync(path.join(sdir, file), 'utf8'))) {
      const schema = typeof group.schema === 'object' && group.schema !== null && !('$schema' in group.schema) ? { ...group.schema, $schema: uri } : group.schema
      if (!compiledEligible(schema)) continue
      const src = compiledModuleFor(schema, { format: 'cjs', plainErrors: true })
      if (!src) continue
      schemas++
      const runtime = new Validator(schema, { richErrors: false })
      const mod = load(src)
      const plain = barePlain(mod)
      // The module a plugin writes for a verdict wrapper: no error collector.
      const vmod = load(compiledModuleFor(schema, { format: 'cjs', verdictOnly: true }) || src)
      const verdict = bareVerdict(vmod)
      const esmPlain = esm.barePlain(mod), esmVerdict = esm.bareVerdict(vmod)
      // bareRich, against a Validator with default options: ata's own errors.
      const runtimeRich = new Validator(schema)
      const richSrc = compiledModuleFor(schema, { format: 'cjs' })
      const rich = richSrc ? bareRich(load(richSrc), compiledSchemaFor(schema)) : null
      for (const t of group.tests) {
        const text = JSON.stringify(t.data)
        for (const [name, a, b] of [
          ['validate', () => show(runtime.validate(JSON.parse(text))), () => show(plain.validate(JSON.parse(text)))],
          ['isValidObject', () => String(runtime.isValidObject(JSON.parse(text))), () => String(plain.isValidObject(JSON.parse(text)))],
          ['input after', () => { const d = JSON.parse(text); runtime.validate(d); return JSON.stringify(d) }, () => { const d = JSON.parse(text); plain.validate(d); return JSON.stringify(d) }],
          ['verdict', () => String(runtime.isValidObject(JSON.parse(text))), () => String(verdict.isValidObject(JSON.parse(text)))],
          ['verdict, input after', () => { const d = JSON.parse(text); runtime.isValidObject(d); return JSON.stringify(d) }, () => { const d = JSON.parse(text); verdict.isValidObject(d); return JSON.stringify(d) }],
          ['esm validate', () => show(runtime.validate(JSON.parse(text))), () => show(esmPlain.validate(JSON.parse(text)))],
          ['esm verdict, input after', () => { const d = JSON.parse(text); const v = runtime.isValidObject(d); return v + JSON.stringify(d) }, () => { const d = JSON.parse(text); const v = esmVerdict.isValidObject(d); return v + JSON.stringify(d) }],
          ...(rich ? [
            ['rich validate', () => show(runtimeRich.validate(JSON.parse(text))), () => show(rich.validate(JSON.parse(text)))],
            ['rich isValidObject, input after', () => { const d = JSON.parse(text); const v = runtimeRich.isValidObject(d); return v + JSON.stringify(d) }, () => { const d = JSON.parse(text); const v = rich.isValidObject(d); return v + JSON.stringify(d) }],
            ['rich validate, input after', () => { const d = JSON.parse(text); runtimeRich.validate(d); return JSON.stringify(d) }, () => { const d = JSON.parse(text); rich.validate(d); return JSON.stringify(d) }],
          ] : []),
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

// What a browser bundle of it holds.
const esbuild = require('esbuild')
const r = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'compiled-bare.mjs')], bundle: true, minify: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'error' })
const inputs = Object.keys(Object.values(r.metafile.outputs)[0].inputs)
for (const m of ['rejections', 'enrich-error', 'suggestions', 'schema-order', 'data-position-cache', 'defaults', 'standard-schema', 'compiled-common']) {
  assert.ok(!inputs.some((f) => f.endsWith(`/lib/${m}.js`)), `the plain wrapper's bundle holds lib/${m}.js`)
}
assert.ok(!inputs.some((f) => f.endsWith('compiled-bare.js')), 'the ES module entry pulls in the CommonJS file, and with it the interop code')
const size = zlib.gzipSync(r.outputFiles[0].contents, { level: 9 }).length
assert.ok(size <= 400, `the bare wrappers bundle to ${size} bytes gzipped, over 400`)
console.log(`ok: barePlain, bareVerdict and bareRich answer as the runtime on ${compared} answers over ${schemas} suite schemas; their bundle is the two functions`)
})().catch((e) => { console.error(e); process.exit(1) })
