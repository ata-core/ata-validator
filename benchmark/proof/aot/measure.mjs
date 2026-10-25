// measure.mjs <path to bun> [runs]: builds server.ts with that bun as an
// executable twice, `bun build --compile` (JIT) and `bun build --compile --aot`,
// starts each, and reports for every route: time from exec to the first
// response, requests answered in the first second, and warm requests per
// second over the next two seconds. Medians over `runs` starts. Use the bun
// from the AOT pull request (bunx bun-pr 45631) for the --aot column.
import { spawn, spawnSync } from 'node:child_process'
const BUN = process.argv[2] || 'bun'
const RUNS = +(process.argv[3] || 5)
const ROUTES = ['/none', '/ata-module', '/ata-runtime', '/zod']
const valid = JSON.stringify({ email: 'ada@example.com', name: 'Ada', age: 36 })
const invalid = JSON.stringify({ email: 'not-an-email', name: '', age: 7, extra: 1 })
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] }
const version = spawnSync(BUN, ['--version'], { encoding: 'utf8' }).stdout.trim()
const hasAot = /--aot/.test(spawnSync(BUN, ['build', '--help'], { encoding: 'utf8' }).stdout)
console.log(`bun ${version}, --aot ${hasAot ? 'available' : 'NOT available in this bun'}`)
const variants = [['jit', ['build', '--compile', './server.ts', '--outfile', './server-jit']]]
if (hasAot) variants.push(['aot', ['build', '--compile', '--aot', './server.ts', '--outfile', './server-aot']])
for (const [name, args] of variants) {
  const t = performance.now(); const r = spawnSync(BUN, args, { encoding: 'utf8' })
  if (r.status !== 0) { console.error(name, 'build failed:\n', r.stderr.slice(0, 2000)); process.exit(1) }
  console.log(`${name}: built in ${((performance.now() - t) / 1000).toFixed(1)} s`)
}
async function once (bin, port, route, body) {
  const t0 = performance.now()
  const p = spawn(bin, [], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
  let first = null
  for (let i = 0; i < 400; i++) {
    try { const r = await fetch(`http://localhost:${port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); await r.text(); first = performance.now() - t0; break } catch { await new Promise((r) => setTimeout(r, 5)) }
  }
  // Requests in the first second after exec, then two warm seconds.
  const count = async (until) => { let n = 0; while (performance.now() < until) { const r = await fetch(`http://localhost:${port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); await r.text(); n++ } return n }
  const firstSecond = await count(t0 + 1000)
  const tw = performance.now(); const warm = await count(tw + 2000); const warmRps = warm / ((performance.now() - tw) / 1000)
  p.kill('SIGKILL'); await new Promise((r) => p.once('exit', r))
  return { first, firstSecond, warmRps }
}
const rows = []
let port = 3200
// One unmeasured start per executable: the first exec of a fresh binary pays
// for paging it in (710 ms once on a 90 MB file), which is the disk, not the
// program.
for (const [name] of variants) await once(`./server-${name}`, port++, '/none', valid)
for (const route of ROUTES) for (const body of [valid, invalid]) {
  for (const [name] of variants) {
    const acc = []
    for (let i = 0; i < RUNS; i++) acc.push(await once(`./server-${name}`, port++, route, body))
    rows.push([route, body === valid ? 'valid' : 'invalid', name, med(acc.map((x) => x.first)), med(acc.map((x) => x.firstSecond)), med(acc.map((x) => x.warmRps))])
  }
}
console.log('\n| route | body | build | first response ms | requests in first second | warm req/s |\n|---|---|---|---|---|---|')
for (const [r, b, n, f, s, w] of rows) console.log(`| ${r} | ${b} | ${n} | ${f.toFixed(1)} | ${s} | ${w.toFixed(0)} |`)
