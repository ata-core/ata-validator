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
writeFileSync(`${outDir}/micro.json`, JSON.stringify(result, null, 2))
console.log(`\nRaw results written to ${outDir}/micro.json`)
