'use strict'

// Three things a security audit found on 2026-11-11 by reading the code, each
// with a document an outside sender can build, none covered by a test:
//
//   - uniqueItems compared by identity when `items` named a primitive type,
//     although the positions `prefixItems` describes may hold objects: two
//     equal objects were taken for different ones and the array accepted.
//     Generated code only; the interpreted engine rejected it.
//   - the text scanner threw a ReferenceError on every document carrying a
//     declared key, for a schema with 48 or more properties two of whose
//     names share a hash, once the scanner was built (after 64 text calls).
//   - idn-hostname encoded a label before checking its length, in time that
//     grows with the square of it: a 100 KB label ran for seconds.

const assert = require('node:assert')
const { Validator } = require('..')

// uniqueItems over a tuple
for (const schema of [
  { type: 'array', prefixItems: [{ type: 'object' }, { type: 'object' }], items: { type: 'string' }, uniqueItems: true },
  { type: 'array', prefixItems: [{ type: 'object' }, { type: 'object' }], items: { type: 'integer' }, uniqueItems: true, maxItems: 8 },
  { $schema: 'http://json-schema.org/draft-07/schema#', items: [{ type: 'object' }, { type: 'object' }], additionalItems: { type: 'string' }, uniqueItems: true },
]) {
  for (const options of [{}, { engine: 'interpreter' }, { richErrors: false }]) {
    const v = new Validator(schema, options)
    for (let i = 0; i < 100; i++) v.isValidObject([{ a: i }, { b: i }])
    const where = JSON.stringify(schema).slice(0, 70) + ' ' + JSON.stringify(options)
    assert.strictEqual(v.isValidObject([{ a: 1 }, { a: 1 }]), false, where + ': two equal objects')
    assert.strictEqual(v.validate([{ a: 1 }, { a: 1 }]).valid, false, where + ': validate')
    assert.strictEqual(v.isValidJSON('[{"a":1},{"a":1}]'), false, where + ': text')
    assert.strictEqual(v.isValidObject([{ a: 1 }, { a: 2 }]), true, where + ': two different objects')
    const tail = schema.items && schema.items.type === 'integer' ? [1, 2] : ['x', 'y']
    assert.strictEqual(v.isValidObject([{ a: 1 }, { b: 1 }, ...tail]), true, where + ': objects, then two different items')
    assert.strictEqual(v.isValidObject([{ a: 1 }, { b: 1 }, tail[0], tail[0]]), false, where + ': objects, then one item twice')
  }
}
// Without a tuple the shortcut stays, and still answers right.
{
  const v = new Validator({ type: 'array', items: { type: 'string' }, uniqueItems: true })
  assert.strictEqual(v.isValidObject(['a', 'b']), true)
  assert.strictEqual(v.isValidObject(['a', 'a']), false)
}

// The scanner and two names with one hash ("ab" and "bA")
{
  const props = {}
  for (let i = 0; i < 46; i++) props['k' + i] = { type: 'integer' }
  props.ab = { type: 'integer' }; props.bA = { type: 'integer' }
  const v = new Validator({ type: 'object', properties: props, required: ['ab'] })
  for (let i = 0; i < 90; i++) {
    assert.strictEqual(v.isValidJSON(JSON.stringify({ ab: 1, bA: 2, k1: i })), true, 'call ' + i)
    assert.strictEqual(v.isValidJSON(JSON.stringify({ ab: 'x', n: i })), false, 'call ' + i)
    assert.strictEqual(v.isValidJSON(JSON.stringify({ bA: 'x', ab: 1, n: i })), false, 'call ' + i)
    assert.strictEqual(v.validateJSON(JSON.stringify({ n: i })).valid, false, 'call ' + i)
  }
}

// idn-hostname on one very long label
{
  const v = new Validator({ type: 'string', format: 'idn-hostname' })
  let label = ''
  for (let i = 0; i < 20000; i++) label += String.fromCharCode(0x4e00 + i)
  const t = process.hrtime.bigint()
  assert.strictEqual(v.isValidObject(label), false)
  assert.strictEqual(v.isValidObject(label + '.example'), false)
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  assert.ok(ms < 200, `a 20000 character label took ${ms.toFixed(0)} ms (it took over 500 before the length was checked first)`)
  let ok = ''
  for (let i = 0; i < 20; i++) ok += String.fromCharCode(0x4e00 + i)
  assert.strictEqual(v.isValidObject(ok + '.example'), true)
}

console.log('test_audit_verdicts: ok')
