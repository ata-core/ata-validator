'use strict'

// Process-wide state of lib/core/engine.js (4b review, condition 3: every
// process-wide cache is bounded). Today the engine has no cache that outlives
// a validator: plans, patterns and resolved references live on the engine
// object. Two checks:
//
// 1. The module's top-level mutable bindings are exactly the known ones (two
//    lazily loaded modules and the test-build flag), and nothing at top level
//    is a Map, Set, WeakMap, WeakRef or array that could collect per schema.
//    A cache added later fails this until the test names it, and then the
//    second check is what holds it.
// 2. 3,000 different schemas are built, each checked with a valid and an
//    invalid value (verdict and errors), and dropped. After a collection,
//    every engine is gone and the heap holds less than 1 MB more than before.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', __filename], { stdio: 'inherit' })
  process.exit(r.status === null ? 1 : r.status)
}

const src = fs.readFileSync(path.join(__dirname, '../lib/core/engine.js'), 'utf8')
const top = src.split('\n').filter((l) => /^(let|var|const) /.test(l))
const mutable = top.filter((l) => /^(let|var) /.test(l)).map((l) => l.split(/[ =]/)[1]).sort()
assert.deepStrictEqual(mutable, ['collapse', 'formatTable', 'off'], 'top-level mutable bindings: ' + mutable.join(', '))
for (const l of top) assert.ok(!/^(?:let|var|const) [\w$]+ = (?:new (?:Map|Set|WeakMap|WeakSet|WeakRef)\b|\[)/.test(l), 'a process-wide collection at top level: ' + l)

const { createEngine } = require('../lib/core/engine.js')

function schema (i) {
  return {
    $defs: { name: { type: 'string', pattern: '^n' + i + '[a-z]*$', maxLength: 40 + i } },
    type: 'object',
    properties: {
      id: { type: 'integer', minimum: i },
      name: { $ref: '#/$defs/name' },
      tag: { enum: ['t' + i, 'u' + i] },
      kind: { anyOf: [{ const: 'k' + i }, { type: 'number' }] },
      list: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    },
    required: ['id', 'name'],
    additionalProperties: false,
  }
}
const good = (i) => ({ id: i, name: 'n' + i + 'ab', tag: 'u' + i, kind: 'k' + i, list: ['a', 'b'] })
const bad = (i) => ({ id: i - 1, name: 'x', tag: 'v', kind: true, list: ['a', 'a'], extra: 1 })

function round (from, n, refs) {
  for (let i = from; i < from + n; i++) {
    const e = createEngine(schema(i), {})
    assert.strictEqual(e.isValid(good(i)), true)
    assert.strictEqual(e.validate(good(i)).valid, true)
    assert.strictEqual(e.isValid(bad(i)), false)
    assert.ok(e.validate(bad(i)).errors.length >= 6)
    if (refs) refs.push(new WeakRef(e))
  }
}
// A WeakRef keeps its target until the job that made it ends, so each
// collection waits a turn first.
const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); globalThis.gc() } }

;(async () => {
  round(0, 200, null)
  await settle()
  const before = process.memoryUsage().heapUsed
  const refs = []
  round(1000, 3000, refs)
  await settle()
  const after = process.memoryUsage().heapUsed
  const alive = refs.filter((r) => r.deref() !== undefined).length
  assert.strictEqual(alive, 0, `${alive} of 3000 engines still reachable after collection`)
  const grown = after - before
  assert.ok(grown < 1024 * 1024, `the heap grew by ${grown} B over 3000 dropped schemas`)
  console.log(`test_core_engine_heap: ok, no process-wide cache; 3000 schemas built and dropped, all collected, heap ${grown >= 0 ? '+' : ''}${(grown / 1024).toFixed(0)} KB`)
})().catch((e) => { console.error(e); process.exit(1) })
