// E2e Fastify benchmark for the HTTP materialization question.
// Three servers: AJV (Fastify default), ata variant-1 (isValid(buf) then JSON.parse),
// ata variant-2 (JSON.parse then isValidObject(obj)). 100% valid traffic.
// Three payload sizes from fixtures/http_payloads.mjs.
//
// Spec: docs/superpowers/specs/2026-05-16-ata-http-materialization-measurement-design.md

import { createRequire } from 'module'
import { writeFileSync, mkdirSync } from 'fs'
import { make, SIZES } from './fixtures/http_payloads.mjs'

const require = createRequire(import.meta.url)
const Fastify = require('./node_modules/fastify')
const autocannon = require('./node_modules/autocannon')
const { Validator } = require('../index.js')

const DURATION = 10
const CONNECTIONS = 2
const WARMUPS = 2
const SLEEP_MS = 2000

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function nextPort(start, offset) { return start + offset }

async function startAjvServer(port, fx) {
  const app = Fastify({ logger: false })
  app.post('/v', { schema: { body: fx.schema } }, async () => ({ ok: true }))
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

async function startAtaV1Server(port, fx) {
  // variant-1: isValid(buf) then JSON.parse only if valid
  const app = Fastify({ logger: false })
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))
  const v = new Validator(fx.schema)
  app.post('/v', async (req, reply) => {
    if (!v.isValid(req.body)) { reply.code(400); return { ok: false } }
    JSON.parse(req.body) // materialize, mirrors what the handler would do
    return { ok: true }
  })
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

async function startAtaV2Server(port, fx) {
  // variant-2: JSON.parse first, then isValidObject(obj) — AJV-shaped order
  const app = Fastify({ logger: false })
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))
  const v = new Validator(fx.schema)
  app.post('/v', async (req, reply) => {
    const obj = JSON.parse(req.body)
    if (!v.isValidObject(obj)) { reply.code(400); return { ok: false } }
    return { ok: true }
  })
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

function runAutocannon(port, body) {
  return new Promise((resolve) => {
    autocannon({
      url: `http://127.0.0.1:${port}/v`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      duration: DURATION,
      connections: CONNECTIONS,
      pipelining: 1,
      body,
    }, (err, result) => {
      if (err) console.error(err)
      resolve(result)
    })
  })
}

async function measureOne(label, startFn, port, fx) {
  const app = await startFn(port, fx)
  try {
    for (let i = 0; i < WARMUPS; i++) await runAutocannon(port, fx.validJson)
    const r = await runAutocannon(port, fx.validJson)
    return {
      label,
      rps: r.requests.average,
      latencyAvg: r.latency.average,
      latencyP99: r.latency.p99,
      throughputMBs: r.throughput.average / 1024 / 1024,
      errors: r.errors,
      non2xx: r.non2xx,
    }
  } finally {
    await app.close()
    await sleep(SLEEP_MS)
  }
}

const PORT_BASE = 3100
const allResults = {}

for (const size of SIZES) {
  console.log(`\n=== size=${size} ===`)
  const fx = make(size)
  console.log(`payload: ${fx.validBuf.length} bytes`)

  const ajv  = await measureOne('ajv',    startAjvServer,   nextPort(PORT_BASE, 0), fx)
  const ata1 = await measureOne('ata-v1', startAtaV1Server, nextPort(PORT_BASE, 1), fx)
  const ata2 = await measureOne('ata-v2', startAtaV2Server, nextPort(PORT_BASE, 2), fx)

  console.log(`  ajv:    ${ajv.rps.toFixed(0)} rps   p99=${ajv.latencyP99.toFixed(2)}ms   non2xx=${ajv.non2xx}`)
  console.log(`  ata-v1: ${ata1.rps.toFixed(0)} rps   p99=${ata1.latencyP99.toFixed(2)}ms   non2xx=${ata1.non2xx}`)
  console.log(`  ata-v2: ${ata2.rps.toFixed(0)} rps   p99=${ata2.latencyP99.toFixed(2)}ms   non2xx=${ata2.non2xx}`)

  allResults[size] = { payloadBytes: fx.validBuf.length, ajv, ata1, ata2 }
}

const outDir = 'benchmark/baselines/2026-05-16/http-materialization'
mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/e2e.json`, JSON.stringify(allResults, null, 2))
console.log(`\nRaw results written to ${outDir}/e2e.json`)
