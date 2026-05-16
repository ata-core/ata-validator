// Feasibility microbench: can simdjson + NAPI materialize beat V8 JSON.parse?
//
// This gates the "fused validate-and-materialize" design. If a generic
// simdjson-NAPI parser cannot beat V8, then ata's hypothetical fused path
// (which adds validation atop the same NAPI materialize) cannot either —
// NAPI is the wall, not parsing.
//
// Compares per payload size:
//   - JSON.parse(str)               V8 baseline (string in)
//   - JSON.parse(buf)               V8 with Buffer in (string conversion baked in)
//   - simdjson.parse(str)           simdjson NAPI parser (npm "simdjson")
//   - buf.toString() + simdjson     emulates HTTP buf-in path for simdjson
//   - simdjson.lazyParse(str)       Proxy-backed lazy accessor (no eager materialize)
//
// Gate criterion: simdjson.parse(str) <= JSON.parse(str) at medium AND large.
// If yes, NAPI materialize has the headroom for fused validate-and-materialize.
// If no, the wall is NAPI itself; redirect to lazy/Proxy plan B.

import { bench, group, run, do_not_optimize } from 'mitata'
import { createRequire } from 'module'
import { writeFileSync, mkdirSync } from 'fs'
import { make, SIZES } from './fixtures/http_payloads.mjs'

const require = createRequire(import.meta.url)
const simdjson = require('./node_modules/simdjson')

const fixtures = {}
for (const size of SIZES) fixtures[size] = make(size)

for (const size of SIZES) {
  const fx = fixtures[size]
  group(`size=${size} (${fx.validBuf.length} bytes)`, () => {
    bench('JSON.parse(str)', () => do_not_optimize(JSON.parse(fx.validJson)))
    bench('JSON.parse(buf)', () => do_not_optimize(JSON.parse(fx.validBuf)))
    bench('simdjson.parse(str)', () => do_not_optimize(simdjson.parse(fx.validJson)))
    bench('buf.toString()+simdjson.parse', () => do_not_optimize(simdjson.parse(fx.validBuf.toString('utf8'))))
    bench('simdjson.lazyParse(str)', () => do_not_optimize(simdjson.lazyParse(fx.validJson)))
  })
}

const result = await run({ json: true })

function slim(r) {
  const t = JSON.parse(JSON.stringify(r))
  if (t.context?.noop) delete t.context.noop
  for (const b of t.benchmarks || []) for (const run of b.runs || []) {
    if (run.stats) { delete run.stats.samples; delete run.stats.debug }
  }
  return t
}

const outDir = 'benchmark/baselines/2026-05-16/http-materialization'
mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/napi_feasibility.json`, JSON.stringify(slim(result), null, 2))

function lookup(name, alias) {
  for (const b of result.benchmarks) {
    if (b.alias !== alias) continue
    if (result.layout?.[b.group]?.name === name) return b.runs?.[0]?.stats?.avg ?? null
  }
  return null
}

console.log('\nCRITERIA EVALUATION (NAPI materialize feasibility)')
console.log('-'.repeat(70))

const verdict = { perSize: [] }
let mediumOk = false, largeOk = false

for (const size of SIZES) {
  const fx = fixtures[size]
  const groupName = `size=${size} (${fx.validBuf.length} bytes)`
  const v8Str = lookup(groupName, 'JSON.parse(str)')
  const sjStr = lookup(groupName, 'simdjson.parse(str)')
  const v8Buf = lookup(groupName, 'JSON.parse(buf)')
  const sjFromBuf = lookup(groupName, 'buf.toString()+simdjson.parse')
  const sjLazy = lookup(groupName, 'simdjson.lazyParse(str)')

  const strRatio = sjStr / v8Str    // <1 means simdjson wins
  const bufRatio = sjFromBuf / v8Buf // <1 means simdjson wins (buf path)
  const winStr = strRatio < 1.0
  const winBuf = bufRatio < 1.0

  console.log(`  ${size}:`)
  console.log(`    JSON.parse(str)               ${v8Str.toFixed(1).padStart(10)} ns`)
  console.log(`    simdjson.parse(str)           ${sjStr.toFixed(1).padStart(10)} ns   ratio=${strRatio.toFixed(2)} ${winStr ? 'WIN' : 'LOSE'}`)
  console.log(`    JSON.parse(buf)               ${v8Buf.toFixed(1).padStart(10)} ns`)
  console.log(`    buf.toString()+simdjson.parse ${sjFromBuf.toFixed(1).padStart(10)} ns   ratio=${bufRatio.toFixed(2)} ${winBuf ? 'WIN' : 'LOSE'}`)
  console.log(`    simdjson.lazyParse(str)       ${sjLazy.toFixed(1).padStart(10)} ns   (lazy — handler-access cost not measured here)`)

  if (size === 'medium' && winStr) mediumOk = true
  if (size === 'large' && winStr) largeOk = true
  verdict.perSize.push({ size, v8Str, sjStr, strRatio, winStr, v8Buf, sjFromBuf, bufRatio, winBuf, sjLazy })
}

const gatePass = mediumOk && largeOk
verdict.gatePass = gatePass

console.log('\n' + '-'.repeat(70))
console.log(`GATE (simdjson.parse(str) <= JSON.parse(str) on medium AND large): ${gatePass ? 'PASS' : 'FAIL'}`)
console.log(gatePass
  ? '  → Fused validate-and-materialize feasibility CONFIRMED. NAPI is not the wall.'
  : '  → NAPI materialize IS the wall. Fused parse+validate+materialize cannot win on materialized output. Pivot to lazy/Proxy plan B (simdjson.lazyParse-style).')

writeFileSync(`${outDir}/napi_feasibility_verdict.json`, JSON.stringify(verdict, null, 2))
