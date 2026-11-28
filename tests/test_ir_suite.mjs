// The IR compiler (lib/ir) against the official test suite, every dialect,
// and its format-assertion cases with formats asserted, on both backends: generated
// modules (also as functions of the kernels object) and closures. A group the IR refuses ("ir: ...") is counted, never
// guessed; every group it accepts must give the suite's verdicts and the
// current engine's full output (every error, every field, in order).
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')
const suite = require('./suite-loader.js')
const { METASCHEMAS } = require('../lib/metaschemas.js')
const { compileClosures } = await import('../lib/ir/index.mjs')
const { compile: compileModule, compileFunction } = await import('./ir-load-module.mjs')

const DIALECTS = Object.keys(suite.DIALECTS)
// What the IR must cover, so coverage cannot shrink unnoticed.
// Every group, on both backends, except in v1: both refuse "unevaluatedProperties
// with $dynamicRef" (a $ref that resolves to nothing), and the module writer
// also refuses two groups whose $dynamicRef resolves only on the scope, which
// needs the closures.
const MIN_GROUPS = { v1: 396, 'draft2020-12': 409, 'draft2019-09': 396, draft7: 285, draft6: 253, draft4: 187 }
const MIN_MODULES = { v1: 394 }

const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => Object.keys(e).map((k) => [k, e[k] === undefined ? '<undef>' : e[k]]))])
let failed = 0
const fail = (m) => { failed++; if (failed <= 10) console.log('  FAIL ' + m) }

// One selection of the suite's files. Every case gets its own external
// documents: the same URI names different documents in different cases.
async function runFiles (files, dialect, assertFormat, backend) {
  let groups = 0; let supported = 0; let cases = 0
  for (const { file, cases: list } of files) {
    for (const g of list) {
      groups++
      const opts = { assertFormat, useDefaults: false, schemas: suite.registry(g) }
      const schema = g.schema
      let eng
      try {
        eng = backend === 'closures' ? compileClosures(schema, { ...opts, metaschemas: METASCHEMAS }) : backend === 'function' ? compileFunction(schema, { ...opts, metaschemas: METASCHEMAS }) : await compileModule(schema, { ...opts, metaschemas: METASCHEMAS })
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

// 'function' is the modules' text run through functionBody: the same groups.
for (const backend of ['closures', 'modules', 'function']) {
  for (const dialect of DIALECTS) {
    const main = await runFiles(suite.files(dialect), dialect, false, backend)
    const min = backend !== 'closures' && MIN_MODULES[dialect] !== undefined ? MIN_MODULES[dialect] : MIN_GROUPS[dialect]
    if (main.supported < min) fail(`${backend} ${dialect}: ${main.supported} groups supported, expected at least ${min}`)
    // The format-assertion cases, at the top level and in optional/.
    const fmtFiles = ['', 'optional'].flatMap((dir) => suite.files(dialect, { dir, which: 'assertion' }))
    const fmt = await runFiles(fmtFiles, dialect, true, backend)
    console.log(`  ${backend.padEnd(8)} ${dialect.padEnd(13)} ${main.supported}/${main.groups} groups, ${main.cases} cases; formats ${fmt.supported}/${fmt.groups} groups, ${fmt.cases} cases`)
  }
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('ok: the IR matches the current engine on every suite group it accepts, both backends and the modules as functions')
