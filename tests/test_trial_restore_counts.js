'use strict'

// A trial emission (a subtree guard, a branch verdict) that is thrown away
// must leave the compile context as it found it. The context's arrays and
// sets only grow during a trial and are cut back by length, but
// sharedDefSites counts the sites of each shared definition: its values
// change, and a copy of the definition is hoisted only at the first site
// that maps to it. Undone by size, a discarded trial took back the copy it
// had hoisted but not the count, and a later site called the copy by a name
// nothing declared. On SARIF the module's one-pass function threw on a valid
// document and reported it invalid.

const assert = require('node:assert')
const { snapshotCtx, restoreCtx } = require('../lib/js-compiler-errors.js')._internal

const ctx = { preamble: ['function a(){}'], sharedDefSites: new Map([['_dv0_m', 3]]), refStack: new Set(['#/a']), varCounter: 7 }
const saved = snapshotCtx(ctx)
ctx.preamble.push('function _dv0_m_c1(d){}')
ctx.sharedDefSites.set('_dv0_m', 5)
ctx.sharedDefSites.set('_dv1_n', 1)
ctx.refStack.add('#/b')
ctx.varCounter = 9
ctx.extra = true
restoreCtx(ctx, saved)

assert.deepStrictEqual(ctx.preamble, ['function a(){}'], 'the hoisted copy is taken back')
assert.deepStrictEqual([...ctx.sharedDefSites], [['_dv0_m', 3]], 'and so is the count that hoisted it')
assert.deepStrictEqual([...ctx.refStack], ['#/a'])
assert.strictEqual(ctx.varCounter, 7, 'a value field is restored too')
assert.strictEqual('extra' in ctx, false)

// A map created during the trial goes with it.
const ctx2 = { preamble: [] }
const saved2 = snapshotCtx(ctx2)
ctx2.sharedDefSites = new Map([['_dv0_m', 2]])
restoreCtx(ctx2, saved2)
assert.strictEqual(ctx2.sharedDefSites, undefined)

console.log('test_trial_restore_counts: ok')
