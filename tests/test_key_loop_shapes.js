'use strict'

// A node with 32 or more optional properties reads them by name while the
// documents come in a few shapes, and from each document's own names once a
// sample has shown more than four. Both forms must answer as the interpreter
// does: before the switch, after it, and on a listed property that is own but
// not enumerable, which a for-in loop does not meet (the item key loop passed
// such a property with a wrong value).

const assert = require('node:assert')
const { Validator } = require('..')

const names = Array.from({ length: 40 }, (_, i) => 'p' + i)
const leafs = [{ type: 'string' }, { type: 'integer', minimum: 0 }, { enum: ['a', 'b'] }, { type: 'string', pattern: '^x' }]
const props = Object.fromEntries(names.map((n, i) => [n, leafs[i % leafs.length]]))
// A longer property, written as a function of its own, and an object one.
props.long = { type: 'object', properties: { a: { type: 'string', minLength: 2 }, b: { type: 'array', items: { type: 'integer' } } }, required: ['a'], additionalProperties: false }
props.anyOfProp = { anyOf: [{ type: 'string', maxLength: 3 }, { type: 'number', multipleOf: 2 }] }

const good = (i) => [`s${i}`, i, 'a', 'x' + i][i % 4]
const bad = (i) => [1, -1, 'c', 'y'][i % 4]
let seed = 11
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
function doc (n, wrong) {
  const o = {}
  for (let j = 0; j < n; j++) { const i = Math.floor(rnd() * names.length); o[names[i]] = good(i) }
  if (wrong) { const i = Math.floor(rnd() * names.length); o[names[i]] = bad(i) }
  if (rnd() < 0.3) o.long = rnd() < 0.5 ? { a: 'ok', b: [1, 2] } : { a: 'o', b: [1] }
  if (rnd() < 0.3) o.anyOfProp = rnd() < 0.5 ? 'abcd' : 4
  if (rnd() < 0.2) o.extra = 1
  return o
}
const hidden = (name, value) => Object.defineProperty({ p0: 's' }, name, { value, enumerable: false })

let checked = 0
for (const [label, schema, wrap] of [
  ['root', { type: 'object', properties: props }, (d) => d],
  ['untyped root', { properties: props }, (d) => d],
  ['nested', { type: 'object', properties: { cfg: { type: 'object', properties: props } }, required: ['cfg'] }, (d) => ({ cfg: d })],
  ['with required', { type: 'object', properties: props, required: ['p0'] }, (d) => { if (d.p0 === undefined && !Object.hasOwn(d, 'p0')) d.p0 = 's'; return d }],
  // Items of different shapes ahead of the one checked: the item key loop is
  // taken where neighbouring items differ.
  ['array items', { type: 'array', items: { type: 'object', properties: props } }, (d) => [{ p4: 's' }, { p5: 1, p6: 'a' }, { p7: 'x' }, d]],
]) {
  const gen = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  const docs = []
  for (let i = 0; i < 400; i++) docs.push(wrap(doc(1 + (i % 6), i % 3 === 0)))
  // The first pass runs while the sample still sees few shapes, the later
  // ones after the switch.
  for (let pass = 0; pass < 3; pass++) {
    for (const d of docs) { assert.strictEqual(gen.isValidObject(d), interp.isValidObject(d), `${label}, pass ${pass}: ${JSON.stringify(d)}`); checked++ }
  }
  for (const [name, value, want] of [['p1', -1, false], ['p1', 3, true], ['p2', 'c', false], ['long', { a: 'o' }, false]]) {
    const d = wrap(hidden(name, value))
    assert.strictEqual(interp.isValidObject(d), want, `${label}: interpreter on hidden ${name}`)
    assert.strictEqual(gen.isValidObject(d), want, `${label}: hidden ${name} = ${JSON.stringify(value)}`)
    checked++
  }
}

// A node whose properties call the recursive entry keeps the named reads.
{
  const rec = { type: 'object', properties: Object.fromEntries(names.map((n) => [n, { $ref: '#' }])) }
  const gen = new Validator(rec)
  const interp = new Validator(rec, { engine: 'interpreter' })
  for (let i = 0; i < 300; i++) {
    const d = { [names[i % 40]]: { [names[(i * 7) % 40]]: i % 5 === 0 ? 1 : {} } }
    assert.strictEqual(gen.isValidObject(d), interp.isValidObject(d), `recursive: ${JSON.stringify(d)}`)
    checked++
  }
}

console.log(`ok: nodes of many optional properties answer as the interpreter before and after the key loop takes over, hidden properties included (${checked} documents)`)
