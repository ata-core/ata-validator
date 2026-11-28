'use strict'

// The browser entry with the code generator, bundled with every name
// minified, as a production build of a page does. Generated code that carries
// a helper's text must not depend on the names a bundler gives it: the
// uniqueItems helpers and the anyOf/oneOf collapse were read with String(fn), and in such a bundle every
// array checked against uniqueItems threw "_uq is not defined" once the page's
// validator ran on generated code (from 1.45.0). Every 2020-12, 2019-09 and draft-07
// suite group runs through the bundle, and each answer and error list must
// match the Validator's.

const assert = require('assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-min-codegen-'))
const entry = path.join(dir, 'entry.mjs')
fs.writeFileSync(entry, `import { Validator } from ${JSON.stringify(path.join(ROOT, 'index.browser.mjs'))}\nimport ${JSON.stringify(path.join(ROOT, 'codegen.mjs'))}\nexport { Validator }\n`)
const result = esbuild.buildSync({
  entryPoints: [entry], bundle: true, platform: 'browser', format: 'esm', minify: true,
  outfile: path.join(dir, 'bundle.mjs'), logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' },
})
assert.strictEqual(result.errors.length, 0, 'the browser entry bundles without errors')

const script = `
  const { Validator: Full } = require(${JSON.stringify(ROOT)})
  const suite = require(${JSON.stringify(path.join(ROOT, 'tests', 'suite-loader.js'))})
  import(${JSON.stringify('file://' + path.join(dir, 'bundle.mjs'))}).then(({ Validator: Min }) => {
    // Values every group is also asked about: the suite's own documents did
    // not reach the anyOf/oneOf collapse of every schema.
    const PROBES = [true, null, 0, 1.5, '', 'x', [], [1], [{}], [[1], { x: 1 }], {}, { a: 1 }, { foo: [] }]
    const shape = (r) => JSON.stringify(r.valid ? true : r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath, e.message]))
    let docs = 0, differ = [], thrown = []
    for (const d of ['draft2020-12', 'draft2019-09', 'draft7']) for (const { file: f, cases } of suite.files(d)) for (const g of cases) {
      if (f.startsWith('format-idn-')) continue
      let a, b
      try { a = new Full(g.schema); b = new Min(g.schema); a.isValidObject(null) } catch { continue }
      for (const t of g.tests.concat(PROBES.map((data) => ({ data })))) {
        docs++
        let want, got
        try { want = shape(a.validate(structuredClone(t.data))) } catch { continue }
        try { b.isValidObject(structuredClone(t.data)); got = shape(b.validate(structuredClone(t.data))) } catch (e) { thrown.push(d + '/' + f + ': ' + g.description + ': ' + e.message); continue }
        if (want !== got) differ.push(d + '/' + f + ': ' + g.description)
      }
    }
    console.log(JSON.stringify({ docs, differ: differ.slice(0, 5), nDiffer: differ.length, thrown: thrown.slice(0, 5), nThrown: thrown.length }))
  })
`
const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim())
fs.rmSync(dir, { recursive: true, force: true })
assert.strictEqual(out.nThrown, 0, 'nothing throws in the minified bundle: ' + out.thrown.join('; '))
assert.strictEqual(out.nDiffer, 0, 'the minified bundle answers as the Validator: ' + out.differ.join('; '))
assert.ok(out.docs > 3000, 'the suite ran: ' + out.docs)
console.log('ok: minified browser bundle with the code generator,', out.docs, 'suite documents, same answers')
