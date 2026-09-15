// isValidJSON with the schema-directed scanner against the same call forced
// through JSON.parse. One variant per process: an in-process A/B of two
// variants of the same hot function drifts with V8 code layout, and this
// measurement has been wrong that way before.
//
//   node benchmark/bench_scan_path.mjs scan|parse [small|medium|large]
//
// With no variant it runs both, seven processes each, and prints the medians.

import { make } from './fixtures/http_payloads.mjs'
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')

const variant = process.argv[2]
const size = process.argv[3] || 'medium'

const fx = make(size)
const good = fx.validJson
const a1 = JSON.parse(good)
const first = Array.isArray(a1) ? a1[0] : a1
first.age = 999
const earlyBad = JSON.stringify(a1)
const a2 = JSON.parse(good)
const last = Array.isArray(a2) ? a2[a2.length - 1] : a2
last.age = 999
const lateBad = JSON.stringify(a2)

function measure(fn) {
  for (let k = 0; k < 3000; k++) fn()
  const runs = []
  for (let r = 0; r < 7; r++) {
    const t0 = process.hrtime.bigint()
    const N = 3000
    for (let k = 0; k < N; k++) fn()
    runs.push(Number(process.hrtime.bigint() - t0) / N)
  }
  runs.sort((a, b) => a - b)
  return runs[3]
}

if (variant === 'scan' || variant === 'parse') {
  const v = new Validator(fx.schema)
  v.isValidJSON(good) // compile before timing
  // A scanner is built only after a caller has asked often enough to earn it;
  // the benchmark is measuring the built state, so it asks for it outright.
  if (typeof v._ensureScanner === 'function') v._ensureScanner(true)
  if (!v._scanner) { console.error('no scanner for this schema'); process.exit(2) }
  if (variant === 'parse') delete v._scanner, v.isValidJSON = (t) => { try { return v.isValidObject(JSON.parse(t)) } catch { return false } }
  // correctness first, and in a pass of its own: mixing it with timing once
  // deoptimised the loop being timed and reported it four times too slow.
  if (v.isValidJSON(good) !== true || v.isValidJSON(earlyBad) !== false || v.isValidJSON(lateBad) !== false) {
    console.error('variant disagrees with the expected verdicts'); process.exit(2)
  }
  const out = {
    valid: measure(() => v.isValidJSON(good)),
    earlyBad: measure(() => v.isValidJSON(earlyBad)),
    lateBad: measure(() => v.isValidJSON(lateBad)),
  }
  console.log(JSON.stringify(out))
  process.exit(0)
}

const self = fileURLToPath(import.meta.url)
function collect(which, sz) {
  const runs = []
  for (let r = 0; r < 7; r++) {
    const line = execFileSync(process.execPath, [self, which, sz], { encoding: 'utf8' }).trim().split('\n').pop()
    runs.push(JSON.parse(line))
  }
  const med = (key) => {
    const xs = runs.map((x) => x[key]).sort((a, b) => a - b)
    return xs[3]
  }
  return { valid: med('valid'), earlyBad: med('earlyBad'), lateBad: med('lateBad') }
}

const CASES = [
  ['valid', 'valid document'],
  ['earlyBad', 'rejected, first element'],
  ['lateBad', 'rejected, last element'],
]
for (const sz of ['small', 'medium', 'large']) {
  const bytes = make(sz).validJson.length
  const p = collect('parse', sz)
  const s = collect('scan', sz)
  console.log(`\n${sz} (${bytes} bytes)`)
  console.log('  ' + 'case'.padEnd(26) + 'parse'.padStart(10) + 'scan'.padStart(10) + '   ratio')
  for (const [key, label] of CASES) {
    const ratio = p[key] / s[key]
    console.log('  ' + label.padEnd(26) + (p[key].toFixed(0) + ' ns').padStart(10) + (s[key].toFixed(0) + ' ns').padStart(10) + '   ' + ratio.toFixed(2) + 'x')
  }
}
