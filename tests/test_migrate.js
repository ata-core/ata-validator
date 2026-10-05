'use strict'

// `ata migrate` reports what switching from ajv to ata-validator/compat
// changes and what it cannot translate, and `--write` applies only the
// mechanical part: the import specifier and the addFormats() statement. The
// fixture project under tests/fixtures/migrate holds the shapes: CommonJS and
// ESM imports, the 2020 entry, the plugins, a TypeScript type import, `$data`,
// a code-generating keyword, and mentions of ajv inside a comment and a
// string that must not count. After --write, the rewritten CommonJS file is
// required and must validate through compat.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { migrate, formatReport, mask } = require('../lib/migrate')

const root = path.resolve(__dirname, '..')
const fixture = path.join(__dirname, 'fixtures', 'migrate')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-migrate-'))
fs.cpSync(fixture, tmp, { recursive: true })
// A dependency tree that mentions ajv everywhere, which the scan must skip,
// and a link so the rewritten file can resolve ata-validator/compat.
fs.mkdirSync(path.join(tmp, 'node_modules', 'ajv'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'node_modules', 'ajv', 'index.js'), "const Ajv = require('ajv/dist/core')\n")
fs.symlinkSync(root, path.join(tmp, 'node_modules', 'ata-validator'), 'dir')

// The masker keeps indexes and line breaks, and blanks comments and strings.
{
  const src = "a = 'x\\'y' // c\n/* d\ne */ b = `t${1}` + \"q\""
  const m = mask(src)
  assert.strictEqual(m.length, src.length)
  assert.strictEqual(m.split('\n').length, src.split('\n').length)
  assert.ok(!m.includes('c') && !m.includes('d') && !m.includes('e */') && !m.includes('q') && !m.includes('t$'), m)
  assert.ok(m.includes('a = ') && m.includes('b = '), m)
}

// Dry run: the report, and nothing written.
const before = {}
for (const f of ['src/plain.js', 'src/esm.mjs', 'src/nested/typed.ts', 'src/nested/none.ts']) before[f] = fs.readFileSync(path.join(tmp, f), 'utf8')
const dry = migrate(tmp)
assert.strictEqual(dry.scanned, 4, 'node_modules is skipped')
assert.strictEqual(dry.report.length, 3, 'the file that never mentions ajv is not in the report')
for (const f of Object.keys(before)) assert.strictEqual(fs.readFileSync(path.join(tmp, f), 'utf8'), before[f], `${f} untouched by a dry run`)
const byFile = Object.fromEntries(dry.report.map((r) => [r.file, r.findings]))
const kinds = (f) => byFile[f].map((x) => `${x.kind}@${x.line}`).join(' ')
assert.strictEqual(kinds('src/plain.js'), 'rewrite@2 delete@3 delete@5', 'plain.js: the import, the plugin import, the addFormats statement; the comment and the string do not count')
assert.strictEqual(kinds('src/esm.mjs'), 'rewrite@1 delete@2 flag@3 flag@6 flag@7 flag@8', 'esm.mjs: the 2020 entry with its note, the plugin import, ajv-errors, an addFormats inside a larger statement, a code keyword, $data')
assert.ok(byFile['src/esm.mjs'][0].note, 'the 2020 entry carries the dialect note')
assert.strictEqual(kinds('src/nested/typed.ts'), 'rewrite@1')
assert.strictEqual(dry.flagged, 4)
const text = formatReport(dry)
assert.ok(text.includes('3 of 4 source files use ajv') && text.includes('4 sites to look at by hand') && text.includes('--write'), text)

// The CLI exits 1 while something is flagged, 0 otherwise.
const cli = spawnSync(process.execPath, [path.join(root, 'bin', 'ata.js'), 'migrate', tmp], { encoding: 'utf8' })
assert.strictEqual(cli.status, 1, cli.stderr)
assert.ok(cli.stdout.includes('src/plain.js'), cli.stdout)
const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-migrate-clean-'))
fs.writeFileSync(path.join(clean, 'a.js'), "const { Validator } = require('ata-validator')\n")
const cli2 = spawnSync(process.execPath, [path.join(root, 'bin', 'ata.js'), 'migrate', clean], { encoding: 'utf8' })
assert.strictEqual(cli2.status, 0, cli2.stderr)
assert.ok(cli2.stdout.includes('no use of ajv found'), cli2.stdout)

// --write: the mechanical changes and nothing else.
const wrote = migrate(tmp, { write: true })
assert.strictEqual(wrote.written, 3)
const after = (f) => fs.readFileSync(path.join(tmp, f), 'utf8')
const plain = after('src/plain.js')
assert.ok(plain.includes("require('ata-validator/compat')"), plain)
assert.ok(!plain.includes("require('ajv-formats')") && !plain.includes('addFormats('), 'the plugin import and the call are gone: ' + plain)
assert.ok(plain.includes("// require('ajv') in a comment") && plain.includes("import Ajv from 'ajv' inside a string"), 'the comment and the string are untouched')
assert.strictEqual(plain.split('\n').length, before['src/plain.js'].split('\n').length - 2, 'two lines removed, nothing else moved')
const esm = after('src/esm.mjs')
assert.ok(esm.includes("from 'ata-validator/compat'") && !esm.includes("from 'ajv-formats'"), esm)
assert.ok(esm.includes('addFormats(ajv); ajvErrors(ajv)'), 'an addFormats inside a larger statement is left for the reader')
assert.ok(esm.includes("from 'ajv-errors'") && esm.includes('code(cxt)') && esm.includes("$data: '1/min'"), 'flagged sites are untouched')
const ts = after('src/nested/typed.ts')
assert.ok(ts.includes('import Ajv, { type ErrorObject } from "ata-validator/compat";'), ts)
assert.strictEqual(after('src/nested/none.ts'), before['src/nested/none.ts'])
// A second run finds the mechanical work done and only the flags left.
const again = migrate(tmp)
assert.strictEqual(again.report.reduce((n, r) => n + r.findings.filter((f) => f.kind !== 'flag').length, 0), 0, 'nothing mechanical left')
assert.strictEqual(again.flagged, 4)

// The rewritten CommonJS file runs on compat.
const check = require(path.join(tmp, 'src', 'plain.js'))
assert.strictEqual(check('a@b.co'), true)
assert.strictEqual(typeof check('nope'), 'string', 'errorsText through compat')

fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(clean, { recursive: true, force: true })
console.log('ok: ata migrate reports 3 files with 6 mechanical changes and 4 flags, writes only the mechanical ones, and the result runs on compat')
