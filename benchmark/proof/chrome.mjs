// Serves ./web, opens csp.html in a fresh headless Chrome and returns the
// page's RESULT line. The CSP meta blocks eval and new Function; the page
// reports that itself.
import { createServer } from 'node:http'; import { readFile, mkdtemp, rm } from 'node:fs/promises'; import { spawn } from 'node:child_process'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const root = new URL('./web/', import.meta.url).pathname
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }
const srv = createServer(async (q, s) => { try { const p = join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); const b = await readFile(p); s.writeHead(200, { 'content-type': types[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); s.end(b) } catch { s.writeHead(404); s.end() } })
await new Promise((r) => srv.listen(0, r)); const port = srv.address().port
const dir = await mkdtemp(join(tmpdir(), 'ata-proof-'))
const ch = spawn(CHROME, ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', 'about:blank'])
let buf = ''
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), 30000)
  ch.stderr.on('data', async (d) => {
    buf += d; const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(buf); if (!m || buf === null) return; buf = null
    try {
      const list = await (await fetch(`http://127.0.0.1:${m[1]}/json/list`)).json()
      const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
      let id = 0; const pend = new Map()
      ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg.result); pend.delete(msg.id) } }
      const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
      await new Promise((r) => (ws.onopen = r))
      await send('Page.navigate', { url: `http://localhost:${port}/csp.html` })
      for (let k = 0; k < 400; k++) {
        const r = await send('Runtime.evaluate', { expression: 'document.body && document.body.textContent', returnByValue: true })
        const t = r && r.result && r.result.value
        if (typeof t === 'string' && t.startsWith('RESULT ')) { clearTimeout(timer); ws.close(); return resolve(JSON.parse(t.slice(7))) }
        await new Promise((r) => setTimeout(r, 25))
      }
      reject(new Error('no RESULT'))
    } catch (e) { reject(e) }
  })
})
ch.kill('SIGKILL'); await new Promise((r) => ch.once('exit', r)); await rm(dir, { recursive: true, force: true }).catch(() => {}); srv.close()
console.log(JSON.stringify(result))
