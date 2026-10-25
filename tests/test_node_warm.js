'use strict'
// The Node entry's idle warm-up (index.js): where a validator was built and
// is still untouched when the event loop turns, one check of a small schema
// runs, accepted and rejected, so that a server's first request does not pay
// for V8 compiling the generator and the error builders. It must not run for
// a script that checks in the same tick as it builds, nor under ATA_NO_WARM.
// Observed through the modules loaded: the error collector's source module
// (lib/js-compiler-errors.js) is loaded by the warm-up's rejected check and
// by nothing else before a validate() call.
const assert = require('assert')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
function probe (tail, env) {
  const r = spawnSync(process.execPath, ['-e', `
    const { Validator } = require(${JSON.stringify(root)})
    const v = new Validator({ type: 'object', properties: { a: { type: 'string' } } }); ${tail}
    const before = new Set(Object.keys(require.cache))
    setTimeout(() => {
      const added = Object.keys(require.cache).filter((k) => !before.has(k) && /js-compiler-errors\\.js$/.test(k))
      console.log(added.length ? 'warm' : 'cold')
    }, 30)
  `], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1', ...env } })
  assert.strictEqual(r.status, 0, r.stderr)
  return r.stdout.trim()
}

assert.strictEqual(probe(''), 'warm', 'a built, untouched validator and a turn of the loop: the warm-up runs')
assert.strictEqual(probe('', { ATA_NO_WARM: '1' }), 'cold', 'ATA_NO_WARM=1 turns it off')
assert.strictEqual(probe("v.isValidObject({ a: 'x' })"), 'cold', 'a verdict compiled in the same tick: nothing to warm')
assert.strictEqual(probe('v.validate({ a: 1 })'), 'cold', 'validate() compiled in the same tick: nothing to warm')
assert.strictEqual(probe('const check = v.isValidObject; void check'), 'cold', 'a method read off the validator counts as in use')

// The warm-up changes no answer and leaves no validator of its own reachable:
// a validator built after it answers as one built before.
{
  const r = spawnSync(process.execPath, ['-e', `
    const { Validator } = require(${JSON.stringify(root)})
    const early = new Validator({ type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 2 } }, additionalProperties: false })
    setTimeout(() => {
      const late = new Validator({ type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 2 } }, additionalProperties: false })
      const docs = [{ n: 2 }, { n: 1 }, { n: 'x' }, { n: 3, x: 1 }, {}]
      const a = docs.map((d) => early.validate(d).errors.map((e) => e.keyword).join(','))
      const b = docs.map((d) => late.validate(d).errors.map((e) => e.keyword).join(','))
      console.log(JSON.stringify([a, b]))
    }, 30)
  `], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
  assert.strictEqual(r.status, 0, r.stderr)
  const [a, b] = JSON.parse(r.stdout.trim())
  assert.deepStrictEqual(a, b)
  assert.deepStrictEqual(a, ['', 'minimum', 'type', 'additionalProperties', 'required'])
}

// A script that finishes in the same tick does not stay for the timer.
{
  const t = Date.now()
  const r = spawnSync(process.execPath, ['-e', `const { Validator } = require(${JSON.stringify(root)}); new Validator({ type: 'string' })`], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.ok(Date.now() - t < 5000)
}

console.log('ok: the Node entry warms the engine once the loop is free, only where a built validator is still untouched')
