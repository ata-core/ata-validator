// The IR compiler (lib/ir) against the official test suite, every dialect,
// and its format tests with formats asserted, on both backends: generated
// modules and closures. A group the IR refuses ("ir: ...") is counted, never
// guessed; every group it accepts must give the suite's verdicts and the
// current engine's full output (every error, every field, in order).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')
const { METASCHEMAS } = require('../lib/metaschemas.js')
const { compileClosures } = await import('../lib/ir/index.mjs')
const { compile: compileModule } = await import('../lib/ir/emit.mjs')

const here = path.dirname(fileURLToPath(import.meta.url))
const SUITE = path.join(here, 'suite/tests')
const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft7: 'http://json-schema.org/draft-07/schema#', draft6: 'http://json-schema.org/draft-06/schema#', draft4: 'http://json-schema.org/draft-04/schema#' }
// What the IR must cover, so coverage cannot shrink unnoticed.
const MIN_GROUPS = { 'draft2020-12': 378, 'draft2019-09': 362, draft7: 258, draft6: 233, draft4: 160 }

const registry = {}
;(function collect (d, prefix) {
  if (!fs.existsSync(d)) return
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name)
    if (e.isDirectory()) collect(full, prefix + e.name + '/')
    else if (e.name.endsWith('.json')) { try { registry['http://localhost:1234/' + prefix + e.name] = JSON.parse(fs.readFileSync(full, 'utf8')) } catch {} }
  }
})(path.join(here, 'suite/remotes'), '')

const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => Object.keys(e).map((k) => [k, e[k] === undefined ? '<undef>' : e[k]]))])
let failed = 0
const fail = (m) => { failed++; if (failed <= 10) console.log('  FAIL ' + m) }

async function runDir (dir, dialect, assertFormat, backend) {
  const opts = { assertFormat, useDefaults: false, schemas: registry }
  const withDialect = (s) => s && typeof s === 'object' && !Array.isArray(s) && !('$schema' in s) ? { ...s, $schema: DIALECTS[dialect] } : s
  let groups = 0; let supported = 0; let cases = 0
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      groups++
      const schema = withDialect(g.schema)
      let eng
      try {
        eng = backend === 'closures' ? compileClosures(schema, { ...opts, metaschemas: METASCHEMAS }) : await compileModule(schema, { ...opts, metaschemas: METASCHEMAS })
      } catch (e) {
        if (!/^ir: /.test(e.message)) fail(`${dialect} ${file} "${g.description}": threw ${e.message}`)
        continue
      }
      supported++
      const ata = new Validator(schema, opts)
      for (const t of g.tests) {
        cases++
        const got = eng.validate(structuredClone(t.data))
        const want = ata.validate(structuredClone(t.data))
        if (want.valid === t.valid && got.valid !== t.valid) fail(`${dialect} ${file} "${g.description}" / "${t.description}": verdict ${got.valid}`)
        if (shape(got) !== shape(want)) fail(`${dialect} ${file} "${g.description}" / "${t.description}": output differs from the current engine`)
      }
    }
  }
  return { groups, supported, cases }
}

for (const backend of ['closures', 'modules']) {
  for (const dialect of Object.keys(DIALECTS)) {
    const main = await runDir(path.join(SUITE, dialect), dialect, false, backend)
    if (main.supported < MIN_GROUPS[dialect]) fail(`${backend} ${dialect}: ${main.supported} groups supported, expected at least ${MIN_GROUPS[dialect]}`)
    const fmtDir = path.join(SUITE, dialect, 'optional/format')
    const fmt = fs.existsSync(fmtDir) ? await runDir(fmtDir, dialect, true, backend) : { supported: 0, cases: 0, groups: 0 }
    console.log(`  ${backend.padEnd(8)} ${dialect.padEnd(13)} ${main.supported}/${main.groups} groups, ${main.cases} cases; formats ${fmt.supported}/${fmt.groups} groups, ${fmt.cases} cases`)
  }
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('ok: the IR matches the current engine on every suite group it accepts, both backends')
