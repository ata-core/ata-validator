// The official JSON Schema Test Suite against Bun's validate<T>, through the
// types `ata build --target bun` writes. For every schema the mapping
// carries, one TypeScript file holds the type and every test's document; a
// Bun with --aot compiles it, and the executable compares validate<T> with the
// suite's expected answer and with ata's plain module. Run by hand:
//
//   node benchmark/proof/aot/suite-differential.mjs [draft2020-12] [path/to/bun]
//
// Prints how many schema groups the mapping carried and the disagreements.
// The one disagreement that would be a bug is a type accepting a document
// the suite calls invalid; a type refusing a valid one costs time, since the
// generated module then asks the plain module, and is listed too.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { schemaToBunType, Declined } = require('../../../lib/bun-target.js')
const { Validator } = require('../../..')

const dialect = process.argv[2] || 'draft2020-12'
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
    try { mapped = schemaToBunType(g.schema, { name: `T${cases.length}` }) } catch (e) {
      if (!(e instanceof Declined)) throw e
      const key = /^keyword /.test(e.reason) ? e.reason : e.reason.replace(/"[^"]*"/g, '"…"')
      declined.set(key, (declined.get(key) || 0) + 1)
      continue
    }
    cases.push({ id: cases.length, mapped, tests: g.tests, group: g.description, file, schema: g.schema })
  }
}

// One executable: the types, the documents, the answers, and ata's module.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-suite-diff-'))
const lines = []
lines.push("import { validate } from 'bun:bundle'")
lines.push("import type { Schema } from 'bun'")
const docs = []
for (const c of cases) {
  for (const [n, src] of c.mapped.aliases) lines.push(`type ${n}_${c.id} = ${src.replace(/\b([A-Z][A-Za-z0-9_$]*)\b(?=\s*[;}|&)\],]|\s*$)/g, (m) => c.mapped.aliases.some((a) => a[0] === m) || m === c.mapped.name ? `${m}_${c.id}` : m)}`)
  lines.push(`type ${c.mapped.name} = ${c.mapped.type.replace(/\b([A-Z][A-Za-z0-9_$]*)\b/g, (m) => c.mapped.aliases.some((a) => a[0] === m) ? `${m}_${c.id}` : m)}`)
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
let tests = 0, agree = 0
const looser = [], stricter = [], moduleDiff = []
const modules = new Map()
for (const [id, i, got] of answers) {
  const c = cases[id]
  const t = c.tests[i]
  tests++
  if (!modules.has(id)) {
    // The suite runner's options: format and default as annotations.
    try { modules.set(id, new Validator(c.schema, { assertFormat: false, useDefaults: false })) } catch { modules.set(id, null) }
  }
  const m = modules.get(id)
  const mv = m ? m.isValidObject(t.data) : null
  if (mv !== null && mv !== t.valid) moduleDiff.push(`${c.file} / ${c.group} / ${t.description}: module ${mv}, suite ${t.valid}`)
  if (got === t.valid) { agree++; continue }
  const line = `${c.file} / ${c.group} / ${t.description}`
  if (got && !t.valid) looser.push(line); else stricter.push(line)
}
console.log(`${dialect}: ${groups} schema groups, ${cases.length} carried as types (${(100 * cases.length / groups).toFixed(1)}%), ${tests} tests of those`)
console.log(`validate<T> agrees with the suite on ${agree} of ${tests}`)
console.log(`type accepts what the suite refuses (a bug in the mapping): ${looser.length}`)
for (const l of looser) console.log('  LOOSER  ' + l)
console.log(`type refuses what the suite accepts (costs a module call): ${stricter.length}`)
for (const l of stricter.slice(0, 40)) console.log('  stricter ' + l)
if (moduleDiff.length) { console.log(`ata disagrees with the suite: ${moduleDiff.length}`); for (const l of moduleDiff) console.log('  MODULE ' + l) }
console.log('declined, by reason:')
for (const [k, n] of [...declined.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
fs.rmSync(dir, { recursive: true, force: true })
process.exit(looser.length ? 2 : 0)
