// The same schema, the same two documents, four places: Node with code
// generation refused, Node, Bun, a page under a Content-Security-Policy in
// headless Chrome, and a Cloudflare Worker under wrangler dev. Each reports
// whether `new Function` works there, what the runtime Validator and the
// module from `ata build` answer, and the time from import to the first
// validated document (medians of RUNS fresh processes; the Worker row has no
// cold figure, its isolate is warm by the time a request is answered).
import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const RUNS = +(process.env.RUNS || 11)
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] }
const rows = []
function probe (label, cmd, args) {
  const out = []
  for (let i = 0; i < RUNS; i++) out.push(JSON.parse(execFileSync(cmd, [...args, label], { encoding: 'utf8' }).trim()))
  const o = out[0]
  rows.push({ env: o.env, newFunction: o.newFunction, engine: o.runtime.engine, runtime: o.runtime, module: o.module, runtimeFirst: med(out.map((x) => x.runtime.firstMs)), moduleFirst: med(out.map((x) => x.module.firstMs)) })
}
probe(`node ${process.version}, --disallow-code-generation-from-strings`, process.execPath, ['--disallow-code-generation-from-strings', 'probe.mjs'])
probe(`node ${process.version}`, process.execPath, ['probe.mjs'])
try { probe(`bun ${execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim()}`, 'bun', ['probe.mjs']) } catch { console.error('bun not found, row skipped') }
// Chrome under CSP.
execFileSync('npx', ['esbuild', 'web/page.mjs', '--bundle', '--minify', '--format=esm', '--platform=browser', '--outfile=web/page.js', '--log-level=error'])
{
  const out = []
  for (let i = 0; i < Math.min(RUNS, 5); i++) out.push(JSON.parse(execFileSync(process.execPath, ['chrome.mjs'], { encoding: 'utf8' }).trim()))
  const o = out[0]
  rows.push({ env: 'Chrome, page under CSP script-src self', newFunction: o.newFunction, engine: 'interpreter', runtime: o.runtime, module: o.module, runtimeFirst: med(out.map((x) => x.runtime.firstMs)), moduleFirst: med(out.map((x) => x.module.firstMs)) })
}
// Cloudflare Workers under wrangler dev.
{
  const w = spawn('npx', ['wrangler', 'dev', '--port', '8799', '--log-level', 'error'], { cwd: 'worker', stdio: 'ignore' })
  const docs = JSON.parse(execFileSync('cat', ['docs.json'], { encoding: 'utf8' }))
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch('http://localhost:8799/newfn')).ok } catch {} if (!ready) await new Promise((r) => setTimeout(r, 1000)) }
  if (!ready) { w.kill(); throw new Error('wrangler dev did not start') }
  const nf = (await (await fetch('http://localhost:8799/newfn')).json()).newFunction
  const ask = async (route, d) => (await fetch('http://localhost:8799/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) })).json()
  const rt = { valid: (await ask('runtime', docs.valid)).valid, invalid: (await ask('runtime', docs.invalid)).valid, keywords: (await ask('runtime', docs.invalid)).keywords }
  const mo = { valid: (await ask('module', docs.valid)).valid, invalid: (await ask('module', docs.invalid)).valid, keywords: (await ask('module', docs.invalid)).keywords }
  w.kill('SIGTERM'); try { execFileSync('pkill', ['-f', 'wrangler dev --port 8799']) } catch {}
  rows.push({ env: 'Cloudflare Workers (wrangler dev, workerd)', newFunction: nf, engine: 'interpreter', runtime: rt, module: mo, runtimeFirst: null, moduleFirst: null })
}
const same = rows.every((r) => r.runtime.valid === true && r.runtime.invalid === false && r.module.valid === true && r.module.invalid === false && JSON.stringify(r.runtime.keywords) === JSON.stringify(rows[0].runtime.keywords) && JSON.stringify(r.module.keywords) === JSON.stringify(rows[0].runtime.keywords))
const ms = (x) => x === null ? 'n/a' : x.toFixed(2) + ' ms'
let md = `| where | \`new Function\` | runtime Validator | module from \`ata build\` | runtime, import to first validation | module, same |\n|---|---|---|---|---|---|\n`
for (const r of rows) md += `| ${r.env} | ${r.newFunction} | ${r.runtime.valid && !r.runtime.invalid ? 'same answers' : 'DIFFERENT'} (${r.engine}) | ${r.module.valid && !r.module.invalid ? 'same answers' : 'DIFFERENT'} | ${ms(r.runtimeFirst)} | ${ms(r.moduleFirst)} |\n`
md += `\nErrors on the invalid document, every row, both validators: ${rows[0].runtime.keywords.join(', ')}. All rows agree: ${same}. Medians of ${RUNS} fresh processes (Chrome ${Math.min(RUNS, 5)}), ${new Date().toISOString().slice(0, 10)}.\n`
writeFileSync('results.md', md); writeFileSync('results.json', JSON.stringify(rows, null, 2))
console.log(md)
