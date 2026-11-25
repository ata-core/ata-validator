'use strict'

// docs/correctness-report.md is written by scripts/gate-report.js and carries
// the record of the run that wrote it. This test fails when the text is not
// what that record renders to (a figure edited by hand, or a renderer change
// with no new report), and when a fresh run of the parts that need no outside
// checkout disagrees with the record on any count: the gate on the official
// suite, the six dialect runs, the run with code generation blocked, the
// suite's commit and, where git has the history, which sweep fixes are in the
// tree. With ATA_SCHEMASTORE=<dir> the SchemaStore gate runs again as well.
//
// When it fails because the tree changed: node scripts/gate-report.js
// --schemastore <dir>, and commit the new report.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const R = require('../scripts/gate-report.js')

const md = fs.readFileSync(R.OUT, 'utf8')
const rec = R.parseRecord(md)

// 1. The text is the record's rendering, byte for byte.
const again = R.render(rec)
if (again !== md) {
  const a = md.split('\n'); const b = again.split('\n')
  let i = 0; while (i < a.length && a[i] === b[i]) i++
  assert.fail(`docs/correctness-report.md differs from its record's rendering at line ${i + 1}:\n  file:     ${String(a[i]).slice(0, 200)}\n  rendered: ${String(b[i]).slice(0, 200)}\nRun node scripts/gate-report.js --schemastore <dir>.`)
}

// 2. Fresh runs against the record. Environment lines (Node, platform, the
// native engine) are not compared: the counts are.
const counts = (g) => ({ exit: g.exit, schemas: g.schemas, paths: g.paths, kinds: g.kinds, report: g.report, known: g.known, knownOrder: g.knownOrder, knownSeen: g.knownSeen, given: g.given })
const stale = 'the committed report disagrees with a fresh run: node scripts/gate-report.js --schemastore <dir>'

assert.deepStrictEqual(R.corpusSuite().commit, rec.corpora.suite.commit, `tests/suite is not at the commit the report was measured on; ${stale}`)
assert.deepStrictEqual(R.measureSuite(), rec.dialects, `official suite figures; ${stale}`)
const ne = R.measureNoEval()
assert.deepStrictEqual(ne, rec.noEval, `figures with code generation blocked; ${stale}`)
assert.deepStrictEqual(counts(R.runGate([])), counts(rec.gate.suite), `gate on the official suite; ${stale}`)

if (process.env.ATA_SCHEMASTORE) {
  assert.ok(rec.gate.schemastore, 'the report has no SchemaStore run')
  assert.deepStrictEqual(counts(R.runGate(['--no-suite', '--schemastore', path.resolve(process.env.ATA_SCHEMASTORE)])), counts(rec.gate.schemastore), `gate on SchemaStore; ${stale}`)
} else console.log('test_gate_report: SchemaStore gate not rerun (set ATA_SCHEMASTORE=<dir> to rerun it)')

// Which sweep fixes are in the tree needs the history: a shallow clone, as CI
// checks out, does not have it.
const shallow = spawnSync('git', ['-C', path.join(__dirname, '..'), 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' })
if (shallow.status === 0 && shallow.stdout.trim() === 'false') {
  const strip = (s) => ({ id: s.id, inTree: s.inTree, fixes: s.fixes, tests: s.tests.map((t) => ({ file: t.file, present: t.present, listed: t.listed })) })
  assert.deepStrictEqual(R.sweepStatus({ run: false }).map(strip), rec.sweep.map(strip), `sweep classes; ${stale}`)
} else console.log('test_gate_report: sweep fixes not compared, the clone has no full history')

console.log(`test_gate_report: report matches its record; suite gate ${rec.gate.suite.schemas} schemas on ${rec.gate.suite.paths.length} paths, six dialects and the run with code generation blocked agree with a fresh run`)
