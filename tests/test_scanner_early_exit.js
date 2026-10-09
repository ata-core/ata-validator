'use strict'

// A member that fails inside the scanner is the verdict unless the object
// repeats that key later, since JSON.parse keeps the last value. The scanner
// used to go on over the whole enclosing object to find out, so a bad first
// item in a long array cost a full pass. Now two native searches over the
// rest of the text, for the key as written and for any backslash (the only
// way to spell the key differently), end the scan when a repeat is not
// there. Held here: the verdict still follows the parser when the key does
// repeat, plain or escaped, and the early exit is real.

const assert = require('node:assert')
const { Validator } = require('..')

const v = new Validator({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } } })
const cases = [
  ['{"a":1}', false],
  ['{"a":1,"a":"x"}', true], // a plain repeat: the parser keeps "x"
  ['{"a":1,"\\u0061":"x"}', true], // an escaped repeat spells the same key
  ['{"a":"ok","a":1}', false], // the repeat is the failing one
  ['{"b":1.5,"a":"ok"}', false],
  ['{"a":1,"c":"\\\\n"}', false], // a backslash elsewhere only costs the shortcut
  ['{"a":1,"nested":{"a":"x"}}', false], // the key inside another object is not a repeat
  ['{"a":"ok","b":2}', true],
]
for (const [doc, want] of cases) {
  assert.strictEqual(v.validate(JSON.parse(doc)).valid, want, 'validate ' + doc)
  assert.strictEqual(v.isValidJSON(doc), want, 'isValidJSON ' + doc)
  assert.strictEqual(v.validateJSON(doc).valid, want, 'validateJSON ' + doc)
}

// The early exit: a 300 KB body whose first item fails must be refused in a
// fraction of the time a valid body takes to scan. The bound is loose, half,
// because the two searches that end the scan are native and their speed
// against the scan loop's varies by machine (a fifth on an M4 Pro, nearer a
// third on a loaded CI runner); before the shortcut the two took the same
// time, so half still tells the shortcut apart from its absence.
const item = { id: 'u1', name: 'Ada', age: 36, tags: ['a', 'b'] }
const list = new Validator({
  type: 'object',
  required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', required: ['id', 'age'], properties: { id: { type: 'string' }, name: { type: 'string' }, age: { type: 'integer', minimum: 13 }, tags: { type: 'array', items: { type: 'string' } } } } } },
})
const n = 6000
const valid = JSON.stringify({ items: Array.from({ length: n }, () => item) })
const badFirst = JSON.stringify({ items: [{ ...item, age: 7 }, ...Array.from({ length: n - 1 }, () => item)] })
assert.ok(valid.length > 300000)
assert.strictEqual(list.isValidJSON(valid), true)
assert.strictEqual(list.isValidJSON(badFirst), false)
const pad = Array.from({ length: 16 }, (_, i) => ' '.repeat(i))
function time (doc, reps) {
  let best = Infinity
  for (let r = 0; r < 5; r++) {
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < reps; i++) list.isValidJSON(doc + pad[i & 15])
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / reps)
  }
  return best
}
const full = time(valid, 30)
const early = time(badFirst, 30)
assert.ok(early < full / 2, `a bad first item should end the scan early: ${(early / 1000).toFixed(1)} us against ${(full / 1000).toFixed(1)} us for the full scan`)
console.log(`ok: a failed member ends the scan when its key cannot repeat (${(early / 1000).toFixed(1)} us against ${(full / 1000).toFixed(1)} us for a valid ${(valid.length / 1024).toFixed(0)} KB body), and a repeat still follows the parser`)
