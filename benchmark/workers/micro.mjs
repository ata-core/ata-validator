// Per-validation cost under the same restriction Workers enforce, in Node:
//   node --disallow-code-generation-from-strings micro.mjs
// Workers freeze the clock inside a request, so the per-call figure is taken
// here; the per-request figure through workerd is in load.mjs. Interleaved
// rounds, medians.
import * as ataCompiled from './gen/user.compiled.mjs'
import { Validator } from 'ata-validator/lite'
import { Validator as CfWorker } from '@cfworker/json-schema'
import ajvStandalone from './gen/ajv-standalone.cjs'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { readFileSync } from 'node:fs'

const schema = JSON.parse(readFileSync('user.schema.json', 'utf8'))
const ataRuntime = new Validator(schema)
const cfworker = new CfWorker(schema, '2020-12', false)
let ajvRuntime
try { const ajv = new Ajv(); addFormats(ajv); ajvRuntime = ajv.compile(schema) } catch (e) { ajvRuntime = e }

const approaches = {
  'ata-compiled': (d) => ataCompiled.validate(d).valid,
  'ata-runtime': (d) => ataRuntime.validate(d).valid,
  cfworker: (d) => cfworker.validate(d).valid,
  'ajv-standalone': (d) => ajvStandalone(d),
  'ajv-runtime': ajvRuntime instanceof Error ? null : (d) => ajvRuntime(d),
}
const valid = { email: 'ada@example.com', name: 'Ada', age: 36 }
const invalid = { email: 'not-an-email', name: '', age: 7, extra: 1 }
const N = 200000, rounds = 7
const res = {}
for (const [name, fn] of Object.entries(approaches)) res[name] = { valid: [], invalid: [] }
for (let r = 0; r < rounds; r++) {
  for (const [name, fn] of Object.entries(approaches)) {
    if (!fn) continue
    for (const [label, doc] of [['valid', valid], ['invalid', invalid]]) {
      let ok = 0
      const t0 = process.hrtime.bigint()
      for (let i = 0; i < N; i++) if (fn(doc)) ok++
      const ns = Number(process.hrtime.bigint() - t0) / N
      if ((label === 'valid') !== (ok === N)) throw new Error(`${name} answered ${ok}/${N} on the ${label} document`)
      res[name][label].push(ns)
    }
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
console.log('| approach | valid document | invalid document |')
console.log('|---|---|---|')
for (const [name, fn] of Object.entries(approaches)) {
  if (!fn) { console.log(`| ${name} | throws ${ajvRuntime.name} at compile | |`); continue }
  console.log(`| ${name} | ${med(res[name].valid).toFixed(0)} ns | ${med(res[name].invalid).toFixed(0)} ns |`)
}
