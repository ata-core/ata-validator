'use strict'
// Under Bun's ahead-of-time compiler, code made at run time with new Function
// is interpreted, and ata's interpreted engine, compiled with the program, is
// six times faster (benchmark/proof/aot/RESULTS.md). Bun resolves the
// package's "aot" export condition there; the entries it names mark the
// process so validators take the interpreted engine by default. Held here:
// the condition comes first and names those entries, the entries survive a
// bundler's tree shaking, and loading one marks the process while the plain
// entry does not.
const assert = require('assert')
const path = require('path')
const { execFileSync } = require('child_process')
const pkg = require('../package.json')

const dot = pkg.exports['.']
assert.strictEqual(Object.keys(dot)[0], 'aot', 'the "aot" condition must come first, or an earlier one wins')
assert.deepStrictEqual(dot.aot, { types: './index.d.ts', import: './index.aot.mjs', require: './index.aot.js' })
for (const f of ['./lib/aot-mark.js', './index.aot.js', './index.aot.mjs']) {
  assert.ok(pkg.sideEffects.includes(f), `${f} is imported for its effect; without a sideEffects entry a bundler drops it`)
}
for (const f of ['index.aot.js', 'index.aot.mjs']) assert.ok(pkg.files.includes(f), `${f} must ship`)

const root = path.join(__dirname, '..')
const engineOf = (code, type) => execFileSync(process.execPath, [...(type ? ['--input-type=module'] : []), '-e', code], { cwd: root, env: { ...process.env, ATA_ENGINE: '' }, encoding: 'utf8' }).trim()
const probe = 'const v = new Validator({ type: "object", properties: { a: { type: "integer" } } }); console.log(v.engine(), v.validate({ a: "x" }).valid)'
assert.strictEqual(engineOf(`const { Validator } = require('./index.aot.js'); ${probe}`), 'interpreter false', 'require of the aot entry')
assert.strictEqual(engineOf(`import { Validator } from './index.aot.mjs'; ${probe}`, true), 'interpreter false', 'import of the aot entry')
assert.notStrictEqual(engineOf(`const { Validator } = require('./index.js'); ${probe}`), 'interpreter false', 'the plain entry must not mark the process')
const aotApi = execFileSync(process.execPath, ['--input-type=module', '-e', "import * as a from './index.aot.mjs'; import * as b from './index.mjs'; console.log(JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()))"], { cwd: root, encoding: 'utf8' }).trim()
assert.strictEqual(aotApi, 'true', 'the aot entry exports what the plain one does')
console.log('ok: the "aot" condition leads, its entries ship and survive tree shaking, and they put validators on the interpreted engine')
