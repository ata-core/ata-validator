'use strict'

// The package as a bundler builds it for a page or a worker answers as Node
// does. Two bugs lived only in bundles, where every other test misses them:
// `import 'ata-validator/idna'` was tree-shaken away (#109) and
// `require('ata-validator')` threw "process is not defined" in a page (#110).
// This bundles the main entry with esbuild for the browser (ESM and require,
// with and without the idna import) and for workerd, runs each bundle in a
// context with browser globals only, and compares verdicts and error fields
// with Node's Validator on the official suite, rich errors and plain.
//
// From 2.0 those conditions resolve the 2.0 entries (index.v2.browser.mjs,
// index.v2.edge.mjs and their require forms), where the rich error fields
// and the json-schema.org meta-schemas are features a page registers. The
// bundles here register both, and then every group must agree with Node. A
// last bundle registers nothing: its errors must carry the fields of
// `richErrors: false`, and what it lacks must be refused by name, never
// answered without it.
//
// The one difference allowed is documented: without the idna import a
// browser bundle holds `hostname` to the letters-digits-hyphens rule and does
// not check `idn-hostname` (lib/idna.browser.js). Those groups are counted
// and must be exactly the hostname format groups.

const assert = require('assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const vm = require('vm')
const esbuild = require('esbuild')
const { Validator } = require('..')

const root = path.join(__dirname, '..')
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-bundle-parity-')))
fs.mkdirSync(path.join(dir, 'node_modules'))
fs.symlinkSync(root, path.join(dir, 'node_modules', 'ata-validator'), 'junction')

const RICH = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'expected', 'received', 'detail', 'suggestion', 'related', 'rank', 'docUrl']
const PLAIN = ['keyword', 'instancePath', 'schemaPath', 'params', 'message']
const USE = `import { richErrors } from 'ata-validator/features/richErrors'\nimport { metaschemas } from 'ata-validator/features/metaschemas'\nValidator.use(richErrors, metaschemas)\n`
const ESM = (pre, use = USE) => `${pre}import { Validator } from 'ata-validator'\n${use}globalThis.__ata = { Validator }\n`
const CJS = `const { Validator } = require('ata-validator')\nValidator.use(require('ata-validator/features/richErrors').richErrors, require('ata-validator/features/metaschemas').metaschemas)\nglobalThis.__ata = { Validator }\n`
const WORKERD = { platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], mainFields: ['browser', 'module', 'main'] }
const CONFIGS = [
  { name: 'browser, import', src: ESM(''), idna: false, opts: { platform: 'browser' } },
  { name: 'browser, import with idna', src: ESM("import 'ata-validator/idna'\n"), idna: true, opts: { platform: 'browser' } },
  { name: 'browser, require', src: CJS, cjs: true, idna: false, opts: { platform: 'browser' } },
  { name: 'workerd, import', src: ESM(''), idna: true, opts: WORKERD },
  { name: 'workerd, require', src: CJS, cjs: true, idna: true, opts: WORKERD },
  { name: 'browser, import, no feature registered', src: ESM('', ''), idna: false, bare: true, opts: { platform: 'browser' } },
]

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', draft7: 'http://json-schema.org/draft-07/schema#' }
const groups = []
for (const dialect of Object.keys(DIALECTS)) {
  for (const sub of ['', 'optional/format']) {
    const d = path.join(root, 'tests/suite/tests', dialect, sub)
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) {
        if (JSON.stringify(g.schema).includes('localhost:1234')) continue
        const schema = g.schema !== null && typeof g.schema === 'object' && !Array.isArray(g.schema) && !('$schema' in g.schema) ? { $schema: DIALECTS[dialect], ...g.schema } : g.schema
        groups.push({ label: `${dialect}/${sub ? sub + '/' : ''}${f}: ${g.description}`, file: f, schema, docs: g.tests.map((t) => t.data) })
      }
    }
  }
}

const RUN = `globalThis.__run = function (schemaJ, docsJ, fieldsJ, optsJ) {
  const schema = JSON.parse(schemaJ), docs = JSON.parse(docsJ), F = JSON.parse(fieldsJ), opts = JSON.parse(optsJ)
  const pick = (e) => F.map((k) => e[k]).concat([Array.isArray(e.branchErrors) ? e.branchErrors.map(pick) : null])
  let v; try { v = new __ata.Validator(schema, opts) } catch (e) { return 'ctor' }
  return JSON.stringify(docs.map((d) => { try { const r = v.validate(d); return [r.valid, v.isValidObject(JSON.parse(JSON.stringify(d))), r.valid ? null : r.errors.map(pick)] } catch (e) { return ['threw', String(e && e.message)] } }))
}`
function inNode (schema, docs, F, opts) {
  const pick = (e) => F.map((k) => e[k]).concat([Array.isArray(e.branchErrors) ? e.branchErrors.map(pick) : null])
  let v; try { v = new Validator(schema, opts) } catch (e) { return 'ctor' }
  return JSON.stringify(docs.map((d) => { try { const r = v.validate(structuredClone(d)); return [r.valid, v.isValidObject(structuredClone(d)), r.valid ? null : r.errors.map(pick)] } catch (e) { return ['threw', String(e && e.message)] } }))
}

;(async () => {
  try {
    for (const c of CONFIGS) {
      const result = esbuild.buildSync({
        stdin: { contents: c.src, resolveDir: dir, sourcefile: c.cjs ? 'entry.cjs' : 'entry.mjs' },
        bundle: true, format: 'iife', write: false, metafile: true, logLevel: 'silent', ...c.opts,
      })
      assert.strictEqual(result.errors.length, 0, c.name + ': bundles')
      const dropped = result.warnings.filter((w) => /side effects|ignor|resolve/i.test(w.text))
      assert.deepStrictEqual(dropped.map((w) => w.text), [], c.name + ': no import dropped or left unresolved')

      const thrown = []
      const g = {
        console, queueMicrotask, structuredClone, TextEncoder, TextDecoder, URL, WeakRef,
        setTimeout: (fn, ms) => setTimeout(() => { try { fn() } catch (e) { thrown.push(e) } }, ms),
        clearTimeout,
      }
      g.self = g
      const ctx = vm.createContext(g)
      vm.runInContext(result.outputFiles[0].text, ctx)
      vm.runInContext(RUN, ctx)
      const which = Object.keys(result.metafile.inputs).filter((k) => /index\.[\w.]+\.m?js$/.test(k)).map((k) => path.basename(k))
      assert.deepStrictEqual(which, [/^workerd/.test(c.name) ? (c.cjs ? 'index.v2.edge.js' : 'index.v2.edge.mjs') : (c.cjs ? 'index.v2.browser.js' : 'index.v2.browser.mjs')], c.name + ': the entry the condition names')

      let compared = 0
      const hostnameOnly = new Set()
      const differ = []
      const refused = new Map()
      // With nothing registered the default errors are the plain ones, and
      // asking for the rich ones is refused.
      const MODES = c.bare ? [[PLAIN, {}, { richErrors: false }], [PLAIN, { richErrors: false }, { richErrors: false }]] : [[RICH, {}, {}], [PLAIN, { richErrors: false }, { richErrors: false }]]
      for (const [F, opts, nodeOpts] of MODES) {
        for (const grp of groups) {
          const want = inNode(grp.schema, grp.docs, F, nodeOpts)
          if (want === 'ctor') continue
          compared++
          const got = ctx.__run(JSON.stringify(grp.schema), JSON.stringify(grp.docs), JSON.stringify(F), JSON.stringify(opts))
          if (got === want) continue
          // A schema the bare entry refuses throws the same refusal on every call.
          const rows = got === 'ctor' ? [] : JSON.parse(got)
          if (c.bare && rows.length > 0 && rows.every((r) => r[0] === 'threw' && r[1] === rows[0][1] && r[1].startsWith('ata2: '))) { refused.set(rows[0][1], (refused.get(rows[0][1]) || 0) + 1); continue }
          // Excused only as a different answer: a bundle that failed to build
          // the validator or threw on a document is never a documented difference.
          const answered = got !== 'ctor' && JSON.parse(got).every((r) => r[0] !== 'threw')
          if (answered && !c.idna && (/^(idn-)?hostname\.json$/.test(grp.file) || /: (idn-)?hostname format$/.test(grp.label))) { hostnameOnly.add(grp.label); continue }
          differ.push(grp.label)
        }
      }
      await new Promise((r) => setTimeout(r, 20))
      assert.deepStrictEqual(thrown.map((e) => String(e && e.message)), [], c.name + ': no timer threw')
      assert.deepStrictEqual(differ, [], c.name + ': answers as Node does')
      if (c.idna) assert.strictEqual(hostnameOnly.size, 0)
      if (c.bare) {
        assert.deepStrictEqual([...refused.keys()], ['ata2: metaschemas, Validator.use(metaschemas)'], c.name + ': only a reference to a meta-schema is refused')
        assert.strictEqual(vm.runInContext(`(() => { try { new __ata.Validator({ type: "string" }, { richErrors: true }).validate(1); return "answered" } catch (e) { return e.message } })()`, ctx), 'ata2: richErrors, Validator.use(richErrors)')
        assert.strictEqual(vm.runInContext(`(() => { try { new __ata.Validator({ type: "string" }, { verbose: true }).validate(1); return "answered" } catch (e) { return e.message } })()`, ctx), 'ata2: verbose, Validator.use(verbose)')
        assert.strictEqual(vm.runInContext(`(() => { try { new __ata.Validator({ type: "string" }, { engine: "interpreter" }); return "answered" } catch (e) { return e.message } })()`, ctx), 'ata2: option engine')
        console.log(`ok: ${c.name}: ${compared - [...refused.values()].reduce((a, b) => a + b, 0)} group runs carry the fields of richErrors: false as Node does, ${[...refused.values()].reduce((a, b) => a + b, 0)} with a reference to a meta-schema are refused by name, as are richErrors: true, verbose and an unknown option`)
        continue
      }
      console.log(`ok: ${c.name}: ${compared} group runs agree with Node${hostnameOnly.size ? `, ${hostnameOnly.size} hostname format groups differ as documented without the idna import` : ''}`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch((e) => { console.error(e); process.exit(1) })
