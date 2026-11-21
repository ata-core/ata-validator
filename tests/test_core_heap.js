'use strict'

// Process-wide state of the verdict core (lib/core/verdict.js,
// verdict-more.js, and feature.js, which makes it the 2.0 Validator's
// engine). Condition 3 of the 4b review: every process-wide cache is bounded.
//
// 1. The top-level mutable bindings and the top-level collections of the
//    three files are exactly the known ones. Each known collection is held
//    by a check below; one added later fails here until it is named.
// 2. 3,000 different schemas go through the core as the Validator uses it
//    (the text questions, then the engine; isValid and validate, with a
//    valid and an invalid value), and are dropped. After a collection,
//    every engine is gone, the heap holds less than 1 MB more than before,
//    and the leaf and pattern tables are back to what they held before.
// 3. While schemas are held, the tables share their leaves and hold no more
//    than their limit.
// 4. The unevaluated* stacks are cut back once a value that pushed many
//    entries has been checked.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', __filename], { stdio: 'inherit' })
  process.exit(r.status === null ? 1 : r.status)
}

// What each file may keep at top level. Collections: the leaf and pattern
// tables (weak, at most LIMIT entries), the unevaluated* stacks (cut back to
// STALE entries), and fixed tables of keyword names and checks.
const KNOWN = {
  'verdict.js': {
    mutable: ['IA', 'linear', 'loadMore', 'moreModule', 'rootEntries', 'rootProps'],
    collections: ['CHECKS', 'CODE', 'KW', 'LISTS', 'MAPS', 'NONE', 'SUBS', 'gone', 'leaves', 'patterns'],
  },
  'verdict-more.js': {
    mutable: ['nc', 'nk', 'np'],
    collections: ['EC', 'EK', 'EP', 'NONE', 'OWN'],
  },
  'feature.js': {
    mutable: ['last', 'verdictFirst'],
    collections: [],
  },
}
const COLLECTION = /^(?:let|var|const) ([\w$]+) = (?:new (?:Map|Set|WeakMap|WeakSet|WeakRef|FinalizationRegistry)\b|\[|Object\.freeze\(\[)/
for (const [file, known] of Object.entries(KNOWN)) {
  const src = fs.readFileSync(path.join(__dirname, '../lib/core', file), 'utf8')
  const top = src.split('\n').filter((l) => /^(let|var|const) /.test(l))
  const mutable = []
  for (const l of top) if (/^(let|var) /.test(l)) for (const d of l.slice(4).split(',')) mutable.push(d.trim().split(/[ =]/)[0])
  assert.deepStrictEqual(mutable.sort(), known.mutable, file + ': top-level mutable bindings: ' + mutable.join(', '))
  const collections = top.map((l) => COLLECTION.exec(l)).filter(Boolean).map((m) => m[1]).sort()
  assert.deepStrictEqual(collections, known.collections, file + ': top-level collections: ' + collections.join(', '))
}

const C = require('../lib/core/verdict.js')
const core = require('../lib/core/feature.js')
const more = require('../lib/core/verdict-more.js')
// Every schema-decided group (lib/groups.js), as the full 2.0 entries register them.
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)

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
      code: { type: 'string', pattern: '^c' + i + '$' },
    },
    required: ['id', 'name'],
    additionalProperties: false,
  }
}
const good = (i) => ({ id: i, name: 'n' + i + 'ab', tag: 'u' + i, kind: 'k' + i, list: ['a', 'b'], code: 'c' + i })
const bad = (i) => ({ id: i - 1, name: 'x', tag: 'v', kind: true, list: ['a', 'a'], code: 'd', extra: 1 })

// As _build asks: the text questions first, then the engine.
function build (s) {
  assert.strictEqual(typeof core(s), 'string')
  return core(s, {})
}
function round (from, n, refs, held) {
  for (let i = from; i < from + n; i++) {
    const e = build(schema(i))
    assert.strictEqual(e.isValid(good(i)), true)
    assert.strictEqual(e.validate(good(i)).valid, true)
    assert.strictEqual(e.isValid(bad(i)), false)
    assert.ok(e.validate(bad(i)).errors.length >= 6)
    if (refs) refs.push(new WeakRef(e))
    if (held) held.push(e)
  }
}
// A WeakRef keeps its target until the job that made it ends, and a
// finalizer runs in a task of its own, so each collection waits a turn first.
const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); globalThis.gc() } }

;(async () => {
  round(0, 200, null, null)
  await settle()
  const t0 = C._tables()
  const before = process.memoryUsage().heapUsed
  const refs = []
  round(1000, 3000, refs, null)
  await settle()
  const after = process.memoryUsage().heapUsed
  const t1 = C._tables()
  const alive = refs.filter((r) => r.deref() !== undefined).length
  assert.strictEqual(alive, 0, `${alive} of 3000 engines still reachable after collection`)
  const grown = after - before
  assert.ok(grown < 1024 * 1024, `the heap grew by ${grown} B over 3000 dropped schemas`)
  assert.ok(t1.patterns <= t0.patterns && t1.leaves <= t0.leaves, `the tables kept dropped schemas' entries: ${JSON.stringify(t0)} then ${JSON.stringify(t1)}`)

  // Held: the tables have the entries, within the limit, and two
  // validators of one schema text share them.
  const held = []
  round(5000, 3000, null, held)
  const t2 = C._tables()
  assert.ok(t2.leaves > t1.leaves + 3000 && t2.leaves <= t2.limit, `leaves while held: ${t2.leaves}`)
  assert.ok(t2.patterns >= t1.patterns + 6000 && t2.patterns <= t2.limit, `patterns while held: ${t2.patterns}`)
  round(5000, 100, null, null)
  assert.ok(C._tables().leaves === t2.leaves && C._tables().patterns === t2.patterns, 'schemas built again from the same text did not share their leaves')
  held.length = 0
  await settle()
  const t3 = C._tables()
  assert.ok(t3.patterns <= t0.patterns && t3.leaves <= t0.leaves, `entries outlived the schemas: ${JSON.stringify(t3)}`)

  // unevaluatedProperties with a pattern from a branch runs on the stacks;
  // a value with 20,000 names pushes as many entries.
  const ev = build({ anyOf: [{ patternProperties: { '^x': { type: 'integer' } } }, { required: ['never'] }], unevaluatedProperties: false })
  const big = {}
  for (let i = 0; i < 20000; i++) big['x' + i] = i
  assert.strictEqual(ev.isValid(big), true)
  big.y = 1
  assert.strictEqual(ev.isValid(big), false)
  const st = more._stacks()
  assert.ok(st.np === 0 && st.nc === 0 && st.nk === 0, 'the stacks were not left empty: ' + JSON.stringify(st))
  assert.ok(st.EP <= st.stale && st.EC <= st.stale && st.EK <= st.stale, 'the stacks kept stale entries: ' + JSON.stringify(st))

  console.log(`test_core_heap: ok, 3000 schemas built and dropped, all collected, heap ${grown >= 0 ? '+' : ''}${(grown / 1024).toFixed(0)} KB; tables ${t1.leaves} leaves and ${t1.patterns} patterns after, ${t2.leaves} and ${t2.patterns} while held (limit ${t2.limit}); stacks cut back`)
})().catch((e) => { console.error(e); process.exit(1) })
