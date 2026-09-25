'use strict'

// The buffer path must keep answering after the native fast-schema registry is
// full.
//
// The native addon keeps compiled schemas for the zero-copy buffer path in a
// fixed array of 4096 slots. Registering the 4097th distinct schema threw
// `Max fast schema slots reached`, and the throw came out of `isValid()`, so
// every validator built after that point in the process was unusable on the
// buffer path. A server that compiles a schema per tenant or per request reaches
// that on its own.
//
// Swallowing the throw is not enough by itself. With no slot the instance holds
// -1, and the native bounds check turns a negative slot into "invalid", so a
// valid document would have been reported invalid. So the fix is to notice there
// is no slot and answer from the JS engine instead: slower, and right.
//
// This is skipped when the addon is absent, since there are no slots to exhaust.

const assert = require('node:assert')
const { Validator } = require('..')

const SLOTS = 4096
const schemaFor = (i) => ({
  additionalProperties: false,
  properties: { ['k' + i]: { type: 'integer' } },
  required: ['k' + i],
  type: 'object',
})

// Probe for the addon the way the loader does, without asserting it is present.
const probe = new Validator(schemaFor('probe'))
probe.isValid(Buffer.from('{"kprobe":1}'))
const hasNative = probe._fastSlot >= 0

if (!hasNative) {
  console.log('skip: no native addon, so there is no fast-schema registry to fill')
  process.exit(0)
}

// --- a repeated schema still reuses its slot ---------------------------------
// The registry deduplicates on the schema text, so a process that builds the
// same schema over and over never fills it. That is the common case and it must
// not have been disturbed.
{
  const shape = { properties: { a: { type: 'integer' } }, type: 'object' }
  const a = new Validator({ ...shape })
  const b = new Validator({ ...shape })
  a.isValid(Buffer.from('{"a":1}'))
  b.isValid(Buffer.from('{"a":1}'))
  assert.strictEqual(a._fastSlot, b._fastSlot, 'the same schema text should share one slot')
  assert.ok(a._fastSlot >= 0, 'and that slot should be a real one')
  console.log('ok: two validators of the same schema share one slot')
}

// --- fill the registry ------------------------------------------------------
// Everything below runs with the registry full, so it has to come after the
// slot-reuse check above.
let registered = 0
for (let i = 0; i < SLOTS + 8; i++) {
  const v = new Validator(schemaFor('fill' + i))
  try {
    v.isValid(Buffer.from(`{"kfill${i}":1}`))
    registered++
  } catch (error) {
    assert.fail(
      `validator ${i} threw on the buffer path instead of degrading: ${error.message}`,
    )
  }
}
console.log(`ok: ${registered} validators used the buffer path without throwing`)

// --- and a fresh one past the limit still answers correctly -----------------
{
  const v = new Validator(schemaFor('past'))
  assert.strictEqual(v._fastSlot, -1, 'this instance should have no fast slot')

  assert.strictEqual(v.isValid(Buffer.from('{"kpast":1}')), true, 'a valid document')
  assert.strictEqual(v.isValid(Buffer.from('{"kpast":"x"}')), false, 'the wrong type')
  assert.strictEqual(v.isValid(Buffer.from('{}')), false, 'a missing required property')
  assert.strictEqual(v.isValid(Buffer.from('{"kpast":1,"extra":2}')), false, 'an extra property')
  assert.strictEqual(v.isValid(Buffer.from('{"kpast":1')), false, 'malformed JSON')
  assert.strictEqual(v.isValid('{"kpast":1}'), true, 'a string is accepted as input')

  // and it must agree with the engine that has nothing to do with slots
  for (const doc of ['{"kpast":1}', '{"kpast":"x"}', '{}', '{"kpast":1,"extra":2}']) {
    assert.strictEqual(
      v.isValid(Buffer.from(doc)),
      v.isValidObject(JSON.parse(doc)),
      `the buffer path and the object path disagree on ${doc}`,
    )
  }
  console.log('ok: past the limit the buffer path agrees with the object path')
}

// --- the other buffer entry points too --------------------------------------
{
  const v = new Validator(schemaFor('batch'))
  assert.strictEqual(v._fastSlot, -1)

  const good = Buffer.from('{"kbatch":1}')
  const bad = Buffer.from('{"kbatch":"x"}')
  assert.strictEqual(v.batchIsValid([good, bad, good]), 2, 'batchIsValid counts the valid ones')
  assert.strictEqual(
    v.countValid(Buffer.from('{"kbatch":1}\n{"kbatch":"x"}\n{"kbatch":2}\n')),
    2,
    'countValid counts the valid lines',
  )
  console.log('ok: batchIsValid and countValid degrade the same way')
}

console.log('\nall fast-slot exhaustion checks passed')
