// Per-request time through workerd (wrangler dev on PORT), one route per
// approach, interleaved rounds so no route gets the warm or the cold end of
// the run. Reports the median and p90 per route and the status codes seen.
import { Agent, fetch } from 'undici'

const port = process.env.PORT || 8789
const base = `http://localhost:${port}`
const agent = new Agent({ keepAliveTimeout: 10000, pipelining: 1 })
const routes = ['/none', '/ata-compiled', '/ata-runtime', '/cfworker', '/ajv-standalone', '/ajv-runtime']
const valid = JSON.stringify({ email: 'ada@example.com', name: 'Ada', age: 36 })
const invalid = JSON.stringify({ email: 'not-an-email', name: '', age: 7, extra: 1 })
const rounds = Number(process.env.ROUNDS || 7)
const per = Number(process.env.PER || 300)

async function one (route, body) {
  const t0 = performance.now()
  const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body, dispatcher: agent })
  await r.text()
  return [performance.now() - t0, r.status]
}

const times = {}; const codes = {}
for (const body of [valid, invalid]) {
  const label = body === valid ? 'valid' : 'invalid'
  for (const route of routes) { times[label + route] = []; codes[label + route] = new Set() }
  for (const r of routes) for (let i = 0; i < 50; i++) await one(r, body) // warm
  for (let round = 0; round < rounds; round++) {
    for (const route of routes) {
      for (let i = 0; i < per; i++) { const [t, s] = await one(route, body); times[label + route].push(t); codes[label + route].add(s) }
    }
  }
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] }
console.log(`| route | valid body, median | p90 | invalid body, median | p90 | status |`)
console.log('|---|---|---|---|---|---|')
for (const route of routes) {
  const v = times['valid' + route]; const i = times['invalid' + route]
  console.log(`| ${route} | ${q(v, 0.5).toFixed(2)} ms | ${q(v, 0.9).toFixed(2)} | ${q(i, 0.5).toFixed(2)} ms | ${q(i, 0.9).toFixed(2)} | ${[...codes['valid' + route]].join('/')} and ${[...codes['invalid' + route]].join('/')} |`)
}
await agent.close()
