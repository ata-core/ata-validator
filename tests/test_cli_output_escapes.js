'use strict'

// What `ata build` prints about a schema file is that file's text in places
// (the $ref it could not resolve, a warning naming a keyword). Control
// characters in it are written as escapes, as `ata validate` writes them: a
// schema from elsewhere could otherwise clear the screen or forge an `ata:`
// line in a terminal or a CI log. Found by a security audit, 2026-11-11.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const c = String.fromCharCode
const ESC = c(0x1b), CSI = c(0x9b), LS = c(0x2028)
const isControl = (n) => (n < 0x20 && n !== 0x0a) || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-cli-esc-'))
try {
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ $ref: 'https://x/' + ESC + '[2J' + ESC + '[Hata: compiled ok' + CSI + '31m' + LS }))
  const r = spawnSync(process.execPath, [path.join(__dirname, '../bin/ata.js'), 'build', 'a.json'], { cwd: dir, encoding: 'utf8' })
  const out = r.stdout + r.stderr
  assert.ok(/skipped/.test(out), 'the schema is reported as skipped: ' + JSON.stringify(out.slice(0, 200)))
  const bad = [...out].filter((ch) => isControl(ch.charCodeAt(0)))
  assert.strictEqual(bad.length, 0, 'no control character reaches the output: ' + JSON.stringify(bad.join('')))
  assert.ok(out.includes('u001b[2J'), 'the escape sequence is shown as text')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log('test_cli_output_escapes: ok')
