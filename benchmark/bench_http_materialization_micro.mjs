// Microbench for the HTTP materialization question.
// Measures: JSON.parse(str), JSON.parse(buf), secure-json-parse(str),
//           ata.isValid(buf), ata.isValidObject(obj), JSON.parse(str)+ata.isValidObject(obj),
//           AJV(JSON.parse(str)).
// Per payload size: small / medium / large from fixtures/http_payloads.mjs.
//
// Spec: docs/superpowers/specs/2026-05-16-ata-http-materialization-measurement-design.md

import { bench, group, run, do_not_optimize } from 'mitata'
import { createRequire } from 'module'
import { writeFileSync, mkdirSync } from 'fs'
import { make, SIZES } from './fixtures/http_payloads.mjs'

const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')
const sjson = require('./node_modules/secure-json-parse')
const Ajv2020 = require('./node_modules/ajv/dist/2020')
const addFormats = require('./node_modules/ajv-formats')

const fixtures = {}
const ataValidators = {}
const ajvValidators = {}

for (const size of SIZES) {
  fixtures[size] = make(size)
  ataValidators[size] = new Validator(fixtures[size].schema)
  const ajv = new Ajv2020({ allErrors: false, strict: false })
  addFormats(ajv)
  ajvValidators[size] = ajv.compile(fixtures[size].schema)
}

for (const size of SIZES) {
  const fx = fixtures[size]
  const ataV = ataValidators[size]
  const ajvV = ajvValidators[size]

  group(`size=${size} (${fx.validBuf.length} bytes)`, () => {
    bench('JSON.parse(str)', () => do_not_optimize(JSON.parse(fx.validJson)))
    bench('JSON.parse(buf)', () => do_not_optimize(JSON.parse(fx.validBuf)))
    bench('secure-json-parse(str)', () => do_not_optimize(sjson.parse(fx.validJson)))
    bench('ata.isValid(buf)', () => do_not_optimize(ataV.isValid(fx.validBuf)))
    bench('ata.isValidObject(obj)', () => do_not_optimize(ataV.isValidObject(fx.validObj)))
    bench('JSON.parse(str) + ata.isValidObject(obj)', () => {
      const o = JSON.parse(fx.validJson)
      do_not_optimize(ataV.isValidObject(o))
    })
    bench('AJV(JSON.parse(str))', () => {
      const o = JSON.parse(fx.validJson)
      do_not_optimize(ajvV(o))
    })
  })
}

const result = await run({ json: true })

const outDir = 'benchmark/baselines/2026-05-16/http-materialization'
mkdirSync(outDir, { recursive: true })

// mitata's per-iter samples + debug fn source dominate the JSON size (>100MB
// otherwise). Strip them; we only need summary stats for the verdict and the
// committed record.
function slim(r) {
  const trimmed = JSON.parse(JSON.stringify(r))
  if (trimmed.context?.noop) delete trimmed.context.noop
  for (const b of trimmed.benchmarks || []) {
    for (const run of b.runs || []) {
      if (run.stats) {
        delete run.stats.samples
        delete run.stats.debug
      }
    }
  }
  return trimmed
}

writeFileSync(`${outDir}/micro.json`, JSON.stringify(slim(result), null, 2))
console.log(`\nRaw results written to ${outDir}/micro.json`)

// --- Verdict ---
// mitata shape: result.benchmarks[].group is an index into result.layout[].
// result.benchmarks[].alias is the bench name. avg lives at .runs[0].stats.avg.

function lookup(result, sizeLabel, benchAlias) {
  for (const b of result.benchmarks) {
    if (b.alias !== benchAlias) continue
    const groupName = result.layout?.[b.group]?.name
    if (groupName !== sizeLabel) continue
    return b.runs?.[0]?.stats?.avg ?? null
  }
  return null
}

console.log('\nCRITERIA EVALUATION (microbench)')
console.log('-'.repeat(70))

let allPass1 = true
let allPass2 = true
const summary = []

for (const size of SIZES) {
  const fx = fixtures[size]
  const groupName = `size=${size} (${fx.validBuf.length} bytes)`

  const parseStr = lookup(result, groupName, 'JSON.parse(str)')
  const parseBuf = lookup(result, groupName, 'JSON.parse(buf)')
  const validateJson = lookup(result, groupName, 'ata.isValid(buf)')
  const parsePlusValidate = lookup(result, groupName, 'JSON.parse(str) + ata.isValidObject(obj)')

  if (parseStr == null || parseBuf == null || validateJson == null || parsePlusValidate == null) {
    console.log(`  ${size}: ERROR — missing measurement (parseStr=${parseStr}, parseBuf=${parseBuf}, validateJson=${validateJson}, combo=${parsePlusValidate})`)
    allPass1 = false
    allPass2 = false
    continue
  }

  const ratio1 = parsePlusValidate / parseStr
  const ratio2 = validateJson / parseBuf
  const pass1 = ratio1 >= 1.4
  const pass2 = ratio2 <= 1.2
  if (!pass1) allPass1 = false
  if (!pass2) allPass2 = false

  console.log(`  ${size}:`)
  console.log(`    Micro #1 (parse+validate / parse >= 1.4):   ${ratio1.toFixed(2)}  ${pass1 ? 'PASS' : 'FAIL'}`)
  console.log(`    Micro #2 (validateJSON / parse <= 1.2):     ${ratio2.toFixed(2)}  ${pass2 ? 'PASS' : 'FAIL'}`)
  summary.push({ size, ratio1, ratio2, pass1, pass2 })
}

console.log('\n' + '-'.repeat(70))
console.log(`Micro #1 (room to win): ${allPass1 ? 'PASS' : 'FAIL'} (all sizes)`)
console.log(`Micro #2 (walk competitive): ${allPass2 ? 'PASS' : 'FAIL'} (all sizes)`)

writeFileSync(
  `${outDir}/micro_verdict.json`,
  JSON.stringify({ micro1AllPass: allPass1, micro2AllPass: allPass2, summary }, null, 2),
)
