'use strict'

// The Node entry bundles. A bundler that bundles a server (esbuild, bun,
// webpack) resolves every literal `require` it meets, and the native engine
// is found through seven optional packages of which at most one is
// installed on any machine: a literal require of each, tried once, failed
// the bundle of every app that imports ata-validator. The loader requires
// the platform package by a computed name on purpose, and this holds it:
// the entry bundles for Node without errors, and the bundle answers.

const assert = require('assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')
const esbuild = require('esbuild')

const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'index.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  minify: true,
})
assert.strictEqual(result.errors.length, 0, 'the Node entry bundles without errors')
const unresolved = result.warnings.filter(w => /Could not resolve/.test(w.text))
assert.strictEqual(unresolved.length, 0, 'nothing the entry requires is left unresolved: ' + unresolved.map(w => w.text).join('; '))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-node-bundle-'))
const file = path.join(dir, 'bundle.cjs')
fs.writeFileSync(file, result.outputFiles[0].text)
const script = `
  const { Validator } = require(${JSON.stringify(file)})
  const v = new Validator({ type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 1 } } })
  const out = [v.validate({ a: 1 }).valid, v.validate({ a: 0 }).valid, v.validate({}).valid, v.validate({ a: 0 }).errors[0].code]
  console.log(JSON.stringify(out))
`
const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim()
fs.rmSync(dir, { recursive: true, force: true })
assert.deepStrictEqual(JSON.parse(out), [true, false, false, 'ATA2003'])
console.log(`ok: the Node entry bundles for Node (${(result.outputFiles[0].text.length / 1024).toFixed(0)} KB minified) and the bundle validates`)
