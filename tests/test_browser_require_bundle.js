'use strict'

// `require('ata-validator')` in a page. The package's `browser` condition sends
// a bundler's require to index.js, so that file runs in a page, where there is
// no `process`. Its warm-up timer read process.env.ATA_NO_WARM directly and
// threw "process is not defined" from the timer, an uncaught error in every
// page that built a validator through require. This bundles the require for
// the browser, runs it where only browser globals exist, lets the timers fire
// and checks nothing threw and the validator answers.

const assert = require('assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const vm = require('vm')
const esbuild = require('esbuild')

const root = path.join(__dirname, '..')
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-browser-require-')))
fs.mkdirSync(path.join(dir, 'node_modules'))
fs.symlinkSync(root, path.join(dir, 'node_modules', 'ata-validator'), 'junction')

const contents = `
const { Validator } = require('ata-validator')
const v = new Validator({ type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] })
globalThis.__out = [v.validate({ a: 1 }).valid, v.validate({ a: 'x' }).valid, v.validate({}).errors[0].keyword]
`

;(async () => {
  try {
    const result = esbuild.buildSync({
      stdin: { contents, resolveDir: dir, sourcefile: 'entry.cjs' },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      write: false,
      logLevel: 'silent',
    })
    assert.strictEqual(result.errors.length, 0, 'the require bundles for the browser')

    const thrown = []
    // Browser globals only: no process, Buffer, require or setImmediate. A
    // timer's error is caught here, as a page would report it.
    const g = {
      console, queueMicrotask, structuredClone, TextEncoder, TextDecoder, URL, WeakRef,
      setTimeout: (fn, ms) => setTimeout(() => { try { fn() } catch (e) { thrown.push(e) } }, ms),
      clearTimeout,
    }
    g.self = g
    const ctx = vm.createContext(g)
    vm.runInContext(result.outputFiles[0].text, ctx)
    await new Promise((r) => setTimeout(r, 50))

    assert.deepStrictEqual(thrown.map((e) => String(e && e.message)), [], 'no timer threw in the page')
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.__out)), [true, false, 'required'], 'the validator answers')
    console.log('ok: require(\'ata-validator\') bundled for the browser runs without process')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch((e) => { console.error(e); process.exit(1) })
