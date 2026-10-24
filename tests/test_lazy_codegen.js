'use strict'

// Requiring the package does not load the code generator (index.js registers
// it to load on first need). A validator still compiles at its first call,
// loading it then, and without a validator it loads once the event loop is
// free, so a server's first request does not wait for it.

const assert = require('node:assert')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const generator = path.join(root, 'lib', 'js-compiler.js')

function probe (body) {
  const code = `const loaded = () => require.cache[${JSON.stringify(generator)}] !== undefined
const { Validator } = require(${JSON.stringify(root)})
${body}`
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// Not loaded by the require, loaded and used by the first call.
{
  const r = probe(`const atImport = loaded()
const v = new Validator({ type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 2 } } })
const afterNew = loaded()
const a = v.validate({ n: 3 }).valid, b = v.validate({ n: 1 }).errors[0].keyword
console.log(JSON.stringify({ atImport, afterNew, afterCall: loaded(), compiled: typeof v._jsFn === 'function', a, b }))`)
  assert.deepStrictEqual(r, { atImport: false, afterNew: false, afterCall: true, compiled: true, a: true, b: 'minimum' })
}

// Loaded once the event loop is free, with no validator in sight.
{
  const r = probe(`const atImport = loaded()
setTimeout(() => console.log(JSON.stringify({ atImport, later: loaded() })), 10)`)
  assert.deepStrictEqual(r, { atImport: false, later: true })
}

// The lite entry never loads it.
{
  const code = `const { Validator } = require(${JSON.stringify(path.join(root, 'lite.js'))})
new Validator({ type: 'integer' }).validate(1)
setTimeout(() => console.log(require.cache[${JSON.stringify(generator)}] !== undefined), 10)`
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.strictEqual(r.stdout.trim(), 'false')
}

console.log('lazy codegen: ok')
