'use strict'

// Under an ahead-of-time compiler the generated code is interpreted and the
// interpreted engine is compiled, so a Validator built with no `engine`
// takes the interpreter there: when Bun says it is such a build (Bun.isAOT),
// or when ATA_ENGINE=interpreter says so. `engine: 'auto'` by name keeps the
// generated code, and the answers are the same either way.

const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const schema = { type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 2 } } }
const probe = (pre, env) => {
  const code = `${pre}
const { Validator } = require(${JSON.stringify(root)})
const S = ${JSON.stringify(schema)}
const out = {}
for (const [k, o] of [['none', undefined], ['auto', { engine: 'auto' }], ['interp', { engine: 'interpreter' }]]) {
  const v = new Validator(S, o); const bad = v.validate({ n: 1 }); const good = v.validate({ n: 3 })
  out[k] = { interpretOnly: v._interpretOnly, generated: typeof v._jsFn === 'function', good: good.valid, bad: bad.valid, keyword: bad.errors[0].keyword }
}
console.log(JSON.stringify(out))`
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, ...env } })
  assert.strictEqual(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// Plain host: generated code by default.
{
  const o = probe('', { ATA_ENGINE: '' })
  assert.strictEqual(o.none.interpretOnly, false); assert.strictEqual(o.none.generated, true)
  assert.strictEqual(o.interp.interpretOnly, true); assert.strictEqual(o.interp.generated, false)
}
// Bun.isAOT: the interpreter by default, generated code when asked for by name.
{
  const o = probe('globalThis.Bun = { isAOT: true };', { ATA_ENGINE: '' })
  assert.strictEqual(o.none.interpretOnly, true, 'Bun.isAOT picks the interpreter'); assert.strictEqual(o.none.generated, false)
  assert.strictEqual(o.auto.interpretOnly, false, "engine: 'auto' keeps generated code"); assert.strictEqual(o.auto.generated, true)
  for (const k of ['none', 'auto', 'interp']) { assert.strictEqual(o[k].good, true); assert.strictEqual(o[k].bad, false); assert.strictEqual(o[k].keyword, 'minimum') }
}
// Bun without the flag, and Bun.isAOT false: unchanged.
{
  assert.strictEqual(probe('globalThis.Bun = { version: "1.4.0" };', { ATA_ENGINE: '' }).none.interpretOnly, false)
  assert.strictEqual(probe('globalThis.Bun = { isAOT: false };', { ATA_ENGINE: '' }).none.interpretOnly, false)
}
// The environment variable, for an executable built before the flag.
{
  const o = probe('', { ATA_ENGINE: 'interpreter' })
  assert.strictEqual(o.none.interpretOnly, true); assert.strictEqual(o.none.generated, false)
  assert.strictEqual(o.auto.interpretOnly, false)
}
console.log('ok: an ahead-of-time host takes the interpreted engine by default, auto by name keeps generated code')
