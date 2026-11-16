'use strict'

// `import 'ata-validator/idna'` is how a browser or edge page turns the
// IDNA2008 checks on (lib/idna.browser.js leaves them out). The import exists
// only for its side effect, so package.json must list idna.js and idna.mjs in
// `sideEffects`: when it did not, a bundler dropped the import as dead, the
// registration never ran, and every idn-hostname was accepted. This bundles
// the documented import for the browser, both as ESM and as require, and
// checks the registration survives and a bad name is rejected.

const assert = require('assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')
const esbuild = require('esbuild')

const root = path.join(__dirname, '..')
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-idna-se-')))
fs.mkdirSync(path.join(dir, 'node_modules'))
fs.symlinkSync(root, path.join(dir, 'node_modules', 'ata-validator'), 'dir')

// U+302E then a Korean label: valid hostname letters, invalid IDNA2008.
const BAD = '\\u302e\\uc2e4\\ub840.\\ud14c\\uc2a4\\ud2b8'
const GOOD = '\\uc2e4\\ub840.\\ud14c\\uc2a4\\ud2b8'
const body = `
const v = new Validator({ type: 'string', format: 'idn-hostname' })
console.log(JSON.stringify([typeof globalThis[Symbol.for('ata-validator.idna')], v.validate('${BAD}').valid, v.validate('${GOOD}').valid]))
`
const entries = {
  esm: `import 'ata-validator/idna'\nimport { Validator } from 'ata-validator'\n${body}`,
  cjs: `require('ata-validator/idna')\nconst { Validator } = require('ata-validator')\n${body}`,
}

try {
  for (const [kind, contents] of Object.entries(entries)) {
    const result = esbuild.buildSync({
      stdin: { contents, resolveDir: dir, sourcefile: 'entry.' + (kind === 'esm' ? 'mjs' : 'cjs') },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      logLevel: 'silent',
    })
    assert.strictEqual(result.errors.length, 0, kind + ': the entry bundles')
    const ignored = result.warnings.filter(w => /no side effects|ignored/i.test(w.text))
    assert.strictEqual(ignored.length, 0, kind + ': the idna import is not dropped: ' + ignored.map(w => w.text).join('; '))
    const file = path.join(dir, 'out-' + kind + '.mjs')
    fs.writeFileSync(file, result.outputFiles[0].text)
    const out = JSON.parse(execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim())
    assert.deepStrictEqual(out, ['function', false, true], kind + ': registration runs, bad idn-hostname rejected, good accepted')
    console.log('ok: ' + kind + ' bundle keeps the idna registration')
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
