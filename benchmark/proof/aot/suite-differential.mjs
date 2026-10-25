// The official JSON Schema Test Suite against Bun's validate<T>, through the
// types `ata build --target bun` writes. For every schema the mapping
// carries, one TypeScript file holds the type and every test's document; a
// Bun with --aot compiles it, and the executable compares validate<T> with the
// suite's expected answer and with ata's plain module. Run by hand:
//
//   node benchmark/proof/aot/suite-differential.mjs [draft2020-12] [path/to/bun]
//
// Prints how many schema groups the mapping carried and the disagreements.
// Where the type does not carry the whole schema, the residual schema is
// checked by ata beside it, as the generated module does. The one
// disagreement that would be a bug is the pair accepting a document the suite
// calls invalid; a pair refusing a valid one costs time, since the generated
// module then asks the plain module, and is listed too.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { schemaToBunType, Declined } = require('../../../lib/bun-target.js')
const { Validator } = require('../../..')

const dialect = process.argv[2] || 'draft2020-12'
const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  draft6: 'http://json-schema.org/draft-06/schema#',
  draft4: 'http://json-schema.org/draft-04/schema#',
  'draft2019-09': 'https://json-schema.org/draft/2019-09/schema',
}
// The suite's schemas carry no $schema; the runner gives them the dialect's.
const withDialect = (s) => (typeof s === 'object' && s !== null && !Array.isArray(s) && s.$schema === undefined) ? { $schema: DIALECTS[dialect], ...s } : s
const bun = process.argv[3] || process.env.BUN || 'bun'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const suiteDir = path.join(root, 'tests/suite/tests', dialect)

const cases = [] // { id, typeSource, aliases, tests: [{ data, valid, desc }], group, file }
const declined = new Map()
let groups = 0
for (const file of fs.readdirSync(suiteDir).filter((f) => f.endsWith('.json')).sort()) {
  const list = JSON.parse(fs.readFileSync(path.join(suiteDir, file), 'utf8'))
  for (const g of list) {
    groups++
    let mapped
    const schema = withDialect(g.schema)
    // The suite reads format as an annotation, as suiteOptions below say.
    // The tagged split, for the pull request build of 2026-10-24 that had validate<T>.
    try { mapped = schemaToBunType(schema, { name: `T${cases.length}`, aliasPrefix: `D${cases.length}_`, assertFormat: false, tags: true }) } catch (e) {
      if (!(e instanceof Declined)) throw e
      const key = /^keyword /.test(e.reason) ? e.reason : e.reason.replace(/"[^"]*"/g, '"…"')
      declined.set(key, (declined.get(key) || 0) + 1)
      continue
    }
    cases.push({ id: cases.length, mapped, tests: g.tests, group: g.description, file, schema, residual: mapped.residual })
  }
}

// One executable: the types, the documents, the answers, and ata's module.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-suite-diff-'))
const lines = []
lines.push("import { validate } from 'bun:bundle'")
lines.push("import type { Schema } from 'bun'")
const docs = []
for (const c of cases) {
  for (const [n, src] of c.mapped.aliases) lines.push(`type ${n} = ${src}`)
  lines.push(`type ${c.mapped.name} = ${c.mapped.type}`)
  lines.push(`function check${c.id} (d: unknown): boolean { try { validate<${c.mapped.name}>(d); return true } catch (e) { if (e instanceof RangeError) throw e; return false } }`)
  for (let i = 0; i < c.tests.length; i++) docs.push({ id: c.id, i, data: c.tests[i].data, valid: c.tests[i].valid })
}
lines.push(`const checks: Array<(d: unknown) => boolean> = [${cases.map((c) => `check${c.id}`).join(', ')}]`)
lines.push(`const docs: Array<{ id: number; i: number; data: unknown; valid: boolean }> = JSON.parse(${JSON.stringify(JSON.stringify(docs))})`)
lines.push('const out: Array<[number, number, boolean]> = []')
lines.push('for (const d of docs) out.push([d.id, d.i, checks[d.id]!(d.data)])')
lines.push("await Bun.write(process.argv[2]!, JSON.stringify(out))")
fs.writeFileSync(path.join(dir, 'diff.ts'), lines.join('\n'))

const build = spawnSync(bun, ['build', '--compile', '--aot', path.join(dir, 'diff.ts'), '--outfile', path.join(dir, 'diff')], { encoding: 'utf8' })
if (build.status !== 0) {
  console.error(build.stderr.split('\n').filter((l) => /error/.test(l)).slice(0, 20).join('\n'))
  console.error(`build failed; the generated file is ${path.join(dir, 'diff.ts')}`)
  process.exit(1)
}
const run = spawnSync(path.join(dir, 'diff'), [path.join(dir, 'out.json')], { encoding: 'utf8' })
if (run.status !== 0) { console.error(run.stderr); process.exit(1) }
const answers = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'))

// Compare with the suite and with ata's runtime engine, which answers as the
// plain module the generated file falls back to (tests/test_compiled_parity.js).
let tests = 0, agree = 0, whole = 0
const looser = [], stricter = [], moduleDiff = []
const modules = new Map()
const residuals = new Map()
// The suite runner's options: format and default as annotations.
const suiteOptions = { assertFormat: false, useDefaults: false }
for (const [id, i, typeOk] of answers) {
  const c = cases[id]
  const t = c.tests[i]
  tests++
  if (!modules.has(id)) {
    try { modules.set(id, new Validator(c.schema, suiteOptions)) } catch { modules.set(id, null) }
    try { residuals.set(id, c.residual === null ? null : new Validator(c.residual, suiteOptions)) } catch (e) { residuals.set(id, undefined); console.log('RESIDUAL DOES NOT COMPILE', c.file, '/', c.group, e.message) }
  }
  const m = modules.get(id)
  const mv = m ? m.isValidObject(t.data) : null
  if (mv !== null && mv !== t.valid) moduleDiff.push(`${c.file} / ${c.group} / ${t.description}: module ${mv}, suite ${t.valid}`)
  const r = residuals.get(id)
  const got = typeOk && (r === null ? true : r === undefined ? false : r.isValidObject(t.data))
  if (got === t.valid) { agree++; continue }
  const line = `${c.file} / ${c.group} / ${t.description}`
  if (got && !t.valid) looser.push(line); else stricter.push(line)
}
whole = cases.filter((c) => c.residual === null).length
console.log(`${dialect}: ${groups} schema groups, ${cases.length} get a Bun target (${(100 * cases.length / groups).toFixed(1)}%), ${whole} of them carried whole by the type, ${tests} tests of those`)
console.log(`type and residual agree with the suite on ${agree} of ${tests}`)
console.log(`type and residual accept what the suite refuses (a bug in the split): ${looser.length}`)
for (const l of looser) console.log('  LOOSER  ' + l)
console.log(`type and residual refuse what the suite accepts (costs a module call): ${stricter.length}`)
for (const l of stricter.slice(0, 40)) console.log('  stricter ' + l)
if (moduleDiff.length) { console.log(`ata disagrees with the suite: ${moduleDiff.length}`); for (const l of moduleDiff) console.log('  MODULE ' + l) }
console.log('declined, by reason:')
for (const [k, n] of [...declined.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
fs.rmSync(dir, { recursive: true, force: true })
process.exit(looser.length ? 2 : 0)
