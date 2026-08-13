// Boot cost of a Fastify-shaped route table: 10 route schemas, from process
// start to the first validated request.
//
// ata builds its validators lazily, so counting only the validator-compiler
// callback flatters it: the compile is still owed and lands on the first
// request. This bench charges both sides for setup plus that first call, and
// runs each configuration in a fresh process so nothing is warm.
//
// Usage: node benchmark/bench_fastify_boot.mjs [runs]
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const RUNS = Number(process.argv[2] || 7)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const SCHEMA = {
  type: 'object',
  required: ['id', 'email'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    email: { type: 'string', minLength: 5 },
    age: { type: 'integer', minimum: 0, maximum: 130 },
    tags: { type: 'array', items: { type: 'string' } },
    address: {
      type: 'object',
      properties: { city: { type: 'string' }, zip: { type: 'string', pattern: '^[0-9]{5}$' } },
    },
  },
}
const PAYLOAD = { id: 1, email: 'a@b.com', age: 3, tags: ['x'], address: { city: 'x', zip: '34000' } }
const ROUTES = 10

// Fastify's default validator compiler runs ajv with these options, so the ata
// side is constructed with the same behavior enabled.
const preamble = `
import { performance } from 'node:perf_hooks'
const SCHEMA = ${JSON.stringify(SCHEMA)}
const PAYLOAD = ${JSON.stringify(PAYLOAD)}
const ROUTES = ${ROUTES}
`

const ajvSrc = `${preamble}
import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(path.join(here, '/'))})
const Ajv = require('ajv')
const t0 = performance.now()
const ajv = new Ajv({ coerceTypes: 'array', useDefaults: true, removeAdditional: true, allErrors: false })
const fns = []
for (let i = 0; i < ROUTES; i++) fns.push(ajv.compile(structuredClone(SCHEMA)))
const setup = performance.now() - t0
const t1 = performance.now()
for (const fn of fns) fn(structuredClone(PAYLOAD))
console.log(JSON.stringify({ setup, first: performance.now() - t1 }))
`

const ataSrc = `${preamble}
const { Validator } = await import(${JSON.stringify(path.join(root, 'index.mjs'))})
const opts = { coerceTypes: true, useDefaults: true, removeAdditional: true }
const t0 = performance.now()
const vs = []
for (let i = 0; i < ROUTES; i++) vs.push(new Validator(structuredClone(SCHEMA), opts))
const setup = performance.now() - t0
const t1 = performance.now()
for (const v of vs) v.isValidObject(structuredClone(PAYLOAD))
console.log(JSON.stringify({ setup, first: performance.now() - t1 }))
`

function measure (src) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8' })
    if (r.status !== 0) {
      console.error(r.stderr)
      process.exit(1)
    }
    runs.push(JSON.parse(r.stdout.trim().split('\n').pop()))
  }
  runs.sort((a, b) => (a.setup + a.first) - (b.setup + b.first))
  return runs[Math.floor(runs.length / 2)]
}

const ajv = measure(ajvSrc)
const ata = measure(ataSrc)
const ajvTotal = ajv.setup + ajv.first
const ataTotal = ata.setup + ata.first

console.log(`${ROUTES} route schemas, median of ${RUNS} fresh processes\n`)
console.log('| Stage | ajv | ata |')
console.log('|---|---|---|')
console.log(`| Setup | ${ajv.setup.toFixed(2)} ms | ${ata.setup.toFixed(2)} ms |`)
console.log(`| First request | ${ajv.first.toFixed(2)} ms | ${ata.first.toFixed(2)} ms |`)
console.log(`| To first validated request | ${ajvTotal.toFixed(2)} ms | ${ataTotal.toFixed(2)} ms |`)
console.log(`\nata reaches the first validated request in ${(ajvTotal / ataTotal).toFixed(1)}x less time.`)
