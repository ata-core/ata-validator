'use strict'

// Runs every SchemaStore schema against SchemaStore's own sample documents and
// requires three answers to agree on each: the default engine, the interpreted
// engine, fromCompiled() and fromCompiledVerdict() around the module compiledModuleFor() writes,
// where it writes one. Verdicts and errors are compared field by field.
//
// The official suite tests keywords one at a time. Real schemas combine them,
// and this run is what found a silent accept that had shipped since 1.0.0
// (a constraint below `additionalProperties: true` was never checked), a
// ReferenceError thrown by validate() since at least 1.20.0, and error order
// that depended on the engine. Every one of them passed the official suite.
//
// Usage: node scripts/schemastore-differential.js <schemastore checkout>
//          [--jobs N] [--min-documents N] [--min-compiled N]
// The checkout needs src/schemas/json, src/test and src/negative_test.
// Exits 1 on any difference, and also when fewer documents or compiled
// schemas were compared than the minimums, so a harness that stops comparing
// cannot pass.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const TIMEOUT_MS = 120000

function docsFor (root, name) {
  const docs = []
  for (const sub of ['test', 'negative_test']) {
    const dir = path.join(root, 'src', sub, name)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      let text
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); JSON.parse(text) } catch { continue }
      docs.push([sub + '/' + f, text])
    }
  }
  return docs
}

// One schema, in its own process: a schema that exhausts memory or hangs
// costs that schema, not the run.
function one (root, file) {
  const { Validator } = require('..')
  const { compiledModuleFor, compiledSchemaFor } = require('../build')
  const { fromCompiled } = require('../lib/compiled')
  const { fromCompiledVerdict } = require('../lib/compiled-verdict')
  const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0) }
  const name = path.basename(file, '.json')
  const docs = docsFor(root, name)
  if (docs.length === 0) out({ skip: 'no sample documents' })
  let schema
  try { schema = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { out({ skip: 'not JSON' }) }
  let runtime, interp
  try {
    runtime = new Validator(schema)
    interp = new Validator(schema, { engine: 'interpreter' })
    runtime.validate({})
    interp.validate({})
  } catch (e) {
    // A reference to a schema outside SchemaStore, most often.
    out({ skip: 'the runtime cannot use it: ' + String(e.message).slice(0, 80) })
  }
  let compiled = null, verdict = null
  try {
    const src = compiledModuleFor(schema, { format: 'cjs' })
    if (src) {
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-ss-')), 'm.cjs')
      fs.writeFileSync(f, src)
      compiled = fromCompiled(require(f), compiledSchemaFor(schema))
      verdict = fromCompiledVerdict(require(f), compiledSchemaFor(schema))
    }
  } catch (e) {
    out({ engine: runtime.engine(), documents: 0, diffs: [{ doc: '(build)', what: 'compiledModuleFor returned a module that did not load: ' + e.message }] })
  }
  const shape = (r) => JSON.stringify(r.valid
    ? { valid: true }
    : { valid: false, errors: r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath, e.message]) })
  const diffs = []
  const differ = (doc, what, a, b) => { if (a !== b) diffs.push({ doc, what, a: a.slice(0, 400), b: b.slice(0, 400) }) }
  for (const [doc, text] of docs) {
    const want = shape(runtime.validate(JSON.parse(text)))
    differ(doc, 'validate: default vs interpreter', want, shape(interp.validate(JSON.parse(text))))
    differ(doc, 'isValidObject: default vs interpreter', String(runtime.isValidObject(JSON.parse(text))), String(interp.isValidObject(JSON.parse(text))))
    if (compiled) {
      differ(doc, 'validate: runtime vs compiled', want, shape(compiled.validate(JSON.parse(text))))
      differ(doc, 'isValidObject: runtime vs compiled', String(runtime.isValidObject(JSON.parse(text))), String(compiled.isValidObject(JSON.parse(text))))
      differ(doc, 'validateJSON: runtime vs compiled', shape(runtime.validateJSON(text)), shape(compiled.validateJSON(text)))
      differ(doc, 'isValidObject: runtime vs verdict', String(runtime.isValidObject(JSON.parse(text))), String(verdict.isValidObject(JSON.parse(text))))
      differ(doc, 'isValidJSON: runtime vs verdict', String(runtime.isValidJSON(text)), String(verdict.isValidJSON(text)))
    }
  }
  out({ engine: runtime.engine(), compiled: !!compiled, documents: docs.length, diffs })
}

async function main (argv) {
  const root = argv[0]
  if (!root || !fs.existsSync(path.join(root, 'src', 'schemas', 'json'))) {
    console.error('usage: node scripts/schemastore-differential.js <schemastore checkout> [--jobs N] [--min-documents N] [--min-compiled N]')
    process.exit(2)
  }
  const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : Number(argv[i + 1]) }
  const jobs = flag('--jobs', Math.max(1, Math.min(6, os.cpus().length - 1)))
  const minDocuments = flag('--min-documents', 1)
  const minCompiled = flag('--min-compiled', 0)
  const dir = path.join(root, 'src', 'schemas', 'json')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  const results = []
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++]
      results.push(await new Promise((resolve) => {
        const p = spawn(process.execPath, ['--max-old-space-size=2048', __filename, '--one', root, path.join(dir, f)], { stdio: ['ignore', 'pipe', 'ignore'] })
        let o = ''
        const t = setTimeout(() => p.kill('SIGKILL'), TIMEOUT_MS)
        p.stdout.on('data', (d) => { o += d })
        p.on('close', () => {
          clearTimeout(t)
          try { resolve({ f, ...JSON.parse(o) }) } catch { resolve({ f, skip: 'crashed, out of memory or timed out' }) }
        })
      }))
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker))
  results.sort((a, b) => (a.f < b.f ? -1 : 1))

  const compared = results.filter((r) => r.documents !== undefined)
  const documents = compared.reduce((n, r) => n + r.documents, 0)
  const compiled = compared.filter((r) => r.compiled).length
  const engines = {}
  for (const r of compared) engines[r.engine] = (engines[r.engine] || 0) + 1
  const skips = {}
  for (const r of results) if (r.skip) { const k = r.skip.replace(/:.*/, ''); skips[k] = (skips[k] || 0) + 1 }
  const failing = compared.filter((r) => r.diffs.length > 0)

  console.log(`${files.length} schemas, ${compared.length} compared on ${documents} sample documents`)
  console.log(`engines: ${Object.entries(engines).map(([k, v]) => `${k} ${v}`).join(', ')}; compiled away: ${compiled}`)
  console.log(`not compared: ${Object.entries(skips).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
  for (const r of failing) {
    console.log(`\n${r.f} (${r.engine})`)
    for (const d of r.diffs.slice(0, 3)) console.log(`  ${d.doc} :: ${d.what}${d.a !== undefined ? `\n    ${d.a}\n    ${d.b}` : ''}`)
    if (r.diffs.length > 3) console.log(`  ... ${r.diffs.length - 3} more`)
  }
  let ok = true
  if (failing.length) { console.log(`\nFAIL: ${failing.length} schemas answer differently`); ok = false }
  if (documents < minDocuments) { console.log(`\nFAIL: compared ${documents} documents, expected at least ${minDocuments}`); ok = false }
  if (compiled < minCompiled) { console.log(`\nFAIL: compiled away ${compiled} schemas, expected at least ${minCompiled}`); ok = false }
  if (ok) console.log('\nok: every compared document gets the same answer from every engine')
  process.exit(ok ? 0 : 1)
}

if (process.argv[2] === '--one') one(process.argv[3], process.argv[4])
else main(process.argv.slice(2))
