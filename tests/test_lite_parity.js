'use strict'

// ata-validator/lite must answer exactly as ata-validator does: the same
// verdict and the same errors, only on the interpreted engine. In one process
// the two share lib/validator-core.js, and loading the full package registers
// the code generator for both, so lite is run in a child process that loads
// nothing else and checks that the code generator never entered it. The parent
// runs the full package over the same cases and compares. Every case of the
// official suite in three dialects, and a matrix of the options that rewrite
// input, go through validate(), isValidObject() and validateJSON(). It reports
// how much it compared.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const OPTION_SETS = [{}, { allErrors: false }, { coerceTypes: true }, { useDefaults: true }, { removeAdditional: true }, { abortEarly: true }]
const OPTION_SCHEMAS = [
  { type: 'object', properties: { n: { type: 'integer', default: 3 }, s: { type: 'string', minLength: 2 }, b: { type: 'boolean' } }, required: ['s'], additionalProperties: false },
  { type: 'object', properties: { list: { type: 'array', items: { type: 'number' } }, nested: { type: 'object', properties: { v: { type: 'string', default: 'x' } } } } },
]
const OPTION_DATA = [{ s: 'ok' }, { s: 'o' }, { s: 'ok', n: '5', b: 'true', extra: 1 }, { list: ['1', 2], nested: {} }, { list: 'x' }, {}, null, 7]

// The suite states the dialect by directory, so each schema gets its $schema
// the way tests/run_suite.js gives it, and the remote documents go in as a
// registry keyed by the URI the suite serves them from.
const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  v1: 'https://json-schema.org/v1',
}
const registry = {}
;(function collect (dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, prefix + e.name + '/')
    else if (e.name.endsWith('.json')) registry['http://localhost:1234/' + prefix + e.name] = JSON.parse(fs.readFileSync(full, 'utf8'))
  }
})(path.join(__dirname, 'suite/remotes'), '')

function withDialect (schema, dialect) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema
  return '$schema' in schema ? schema : { ...schema, $schema: DIALECTS[dialect] }
}

function cases () {
  const out = []
  for (const dialect of Object.keys(DIALECTS)) {
    const dir = path.join(__dirname, 'suite/tests', dialect)
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        out.push({ schema: withDialect(g.schema, dialect), opts: { schemas: registry }, data: g.tests.map((t) => t.data) })
      }
    }
  }
  for (const schema of OPTION_SCHEMAS) for (const opts of OPTION_SETS) out.push({ schema, opts, data: OPTION_DATA })
  return out
}

function answer (Validator, c) {
  let v
  try { v = new Validator(c.schema, c.opts) } catch (e) { return { threw: e.name } }
  return c.data.map((d) => {
    const copy = () => (d === undefined ? d : JSON.parse(JSON.stringify(d)))
    const r = v.validate(copy())
    const text = JSON.stringify(d)
    const j = text === undefined ? null : v.validateJSON(text)
    return {
      valid: r.valid,
      data: r.valid ? r.data : undefined,
      errors: r.valid ? [] : r.errors.map((e) => [e.code, e.keyword, e.instancePath, e.schemaPath, e.message]),
      verdict: v.isValidObject(copy()),
      json: j && { valid: j.valid, errors: j.valid ? [] : j.errors.map((e) => [e.code, e.keyword, e.instancePath]) },
    }
  })
}

if (process.argv[2] === '--child') {
  const lite = require('../lite')
  const loaded = Object.keys(require.cache).filter((k) => /js-compiler|scan-compiler|clone-emit|ts-gen|render-|\/index\.js$/.test(k))
  const probe = new lite.Validator({ type: 'string' })
  const report = { loaded, engine: probe.engine(), answers: cases().map((c) => answer(lite.Validator, c)) }
  let parseError = null
  try { new lite.Validator({ type: 'object', properties: { a: { type: 'string' } } }).parse({ a: 'x' }) } catch (e) { parseError = e.constructor.name }
  report.parseError = parseError
  // The methods that need the code generator refuse with a TypeError that
  // names lite, rather than failing somewhere inside.
  report.refusals = ['bundle', 'bundleCompact', 'bundleStandalone', 'loadBundle', 'fromStandalone'].map((m) => {
    try { lite.Validator[m]({}, {}); return m + ': no error' } catch (e) { return e instanceof TypeError && /lite/.test(e.message) ? 'ok' : m + ': ' + e.message }
  })
  fs.writeFileSync(process.argv[3], JSON.stringify(report))
  process.exit(0)
}

// Twice: once as Node with the addon installed, once without it, which is
// what a browser, a worker or an edge runtime is.
function runChild (noNative) {
  const out = path.join(require('os').tmpdir(), `ata-lite-parity-${process.pid}-${noNative ? 'js' : 'addon'}.json`)
  const env = { ...process.env }
  if (noNative) env.ATA_NO_NATIVE = '1'
  else delete env.ATA_NO_NATIVE
  execFileSync(process.execPath, [__filename, '--child', out], { stdio: 'inherit', env })
  const report = JSON.parse(fs.readFileSync(out, 'utf8'))
  fs.unlinkSync(out)
  assert.deepStrictEqual(report.loaded, [], 'the code generator entered a process that loaded only lite: ' + report.loaded.join(', '))
  assert.strictEqual(report.engine, 'interpreter', 'lite answers on the interpreted engine')
  assert.strictEqual(report.parseError, 'TypeError', 'parse() declines in lite with a TypeError')
  assert.deepStrictEqual(report.refusals, ['ok', 'ok', 'ok', 'ok', 'ok'])
  return report
}
const children = [['with the addon', runChild(false)], ['without the addon', runChild(true)]]

function label (opts) { return JSON.stringify(opts, (k, v) => (k === 'schemas' ? '[suite remotes]' : v)) }

const full = require('..')
const all = cases()
const wanted = all.map((c) => JSON.stringify(answer(full.Validator, c)))
const SHOW = Number(process.env.LITE_SHOW) || 5
let compared = 0
for (const [where, child] of children) {
  let bad = 0
  for (let i = 0; i < all.length; i++) {
    const want = wanted[i]
    const got = JSON.stringify(child.answers[i])
    compared += Array.isArray(child.answers[i]) ? child.answers[i].length : 1
    if (want === got) continue
    if (bad++ < SHOW) {
      const W = JSON.parse(want), G = child.answers[i]
      console.error(`${where}: case ${i} ${JSON.stringify(all[i].schema).slice(0, 160)} ${label(all[i].opts)}`)
      if (!Array.isArray(W) || !Array.isArray(G)) { console.error(`  full ${want.slice(0, 300)}\n  lite ${got.slice(0, 300)}`); continue }
      W.forEach((w, k) => {
        for (const key of Object.keys(w)) {
          if (JSON.stringify(w[key]) !== JSON.stringify(G[k][key])) console.error(`  data ${JSON.stringify(all[i].data[k]).slice(0, 80)} ${key}\n    full ${JSON.stringify(w[key]).slice(0, 300)}\n    lite ${JSON.stringify(G[k][key]).slice(0, 300)}`)
        }
      })
    }
  }
  assert.strictEqual(bad, 0, `${where}: ${bad} of ${all.length} schemas answered differently in lite`)
}
assert.ok(compared > 6600, `compared ${compared} answers: too few`)
console.log(`ok: ata-validator/lite answers as ata-validator on ${compared} documents over ${all.length} schemas, with and without the addon, with no code generator loaded`)
