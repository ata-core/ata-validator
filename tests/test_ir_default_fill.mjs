// The module writer's default fill against the current engine's, on the
// objects a fill can get wrong: explicit undefined, names inherited from a
// custom prototype or a class, a null prototype, a non-enumerable own name,
// a name Object.prototype carries. (Reading a value before asking whether the
// name is own was tried and dropped: a missing name read where many object
// shapes pass costs more than hasOwnProperty, tslint's fill 4x.)
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import * as K from '../lib/kernels/index.mjs'
import { compileClosures } from '../lib/ir/index.mjs'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')

const schema = {
  type: 'object',
  properties: {
    a: { type: 'string', default: 'A' },
    b: { type: 'number', default: 1 },
    toString: { default: 'own toString' },
    nested: { type: 'object', default: {}, properties: { c: { type: 'boolean', default: true } } },
  },
}
const src = specialize(schema, { assertFormat: false, useDefaults: true, verdict: true })
const mod = new Function('K', functionBody(src))(K)
const ata = new Validator(schema, { useDefaults: true })

class Box { }
Box.prototype.a = 'inherited'
const docs = {
  'empty': () => ({}),
  'all present': () => ({ a: 'x', b: 2, toString: 't', nested: { c: false } }),
  'explicit undefined': () => ({ a: undefined, nested: { c: undefined } }),
  'inherited from a custom prototype': () => Object.create({ a: 'inherited', b: 5 }),
  'a class instance': () => new Box(),
  'a null prototype': () => Object.assign(Object.create(null), { b: 3 }),
  'non-enumerable own': () => Object.defineProperty({}, 'a', { value: 'hidden', enumerable: false, writable: true, configurable: true }),
  'nested missing': () => ({ nested: {} }),
  'nested not an object': () => ({ nested: 'text' }),
}
const show = (o) => JSON.stringify(Object.getOwnPropertyNames(o).sort().map((k) => [k, o[k], Object.prototype.propertyIsEnumerable.call(o, k)]))
for (const [name, make] of Object.entries(docs)) {
  const x = make(); const y = make()
  const vx = ata.validate(x).valid
  const vy = mod.validate(y).valid
  assert.strictEqual(vy, vx, `${name}: verdict`)
  assert.strictEqual(show(y), show(x), `${name}: filled document`)
  if (x.nested && typeof x.nested === 'object') assert.strictEqual(show(y.nested), show(x.nested), `${name}: nested filled document`)
}
// Twenty properties whose values have defaults inside: the fill walks the
// object's own names and looks each up (fillWalk) instead of asking about all
// twenty. Own non-enumerable names count, inherited ones do not.
const rule = { type: 'object', properties: { on: { type: 'boolean', default: true }, level: { default: 'warn' } } }
const many = { type: 'object', properties: Object.fromEntries([...Array(20)].map((_, i) => ['r' + i, rule])) }
const manySrc = specialize(many, { assertFormat: false, useDefaults: true, verdict: true })
assert.ok(manySrc.includes('getOwnPropertyNames'), 'twenty filled properties: the fill does not walk the object, so the case under test did not run')
const manyMod = new Function('K', functionBody(manySrc))(K)
const manyAta = new Validator(many, { useDefaults: true })
const manyDocs = {
  'two present': () => ({ r0: {}, r7: { on: false } }),
  'none present': () => ({}),
  'a present name holding undefined': () => ({ r1: undefined, r2: {} }),
  'a non-enumerable own name': () => Object.defineProperty({ r3: {} }, 'r4', { value: {}, enumerable: false, writable: true, configurable: true }),
  'an inherited name': () => Object.create({ r5: {} }),
  'a null prototype': () => Object.assign(Object.create(null), { r6: {}, x: 1 }),
  'a value that is not an object': () => ({ r8: 'text', r9: [1] }),
}
for (const [name, make] of Object.entries(manyDocs)) {
  const x = make(); const y = make()
  assert.strictEqual(manyMod.validate(y).valid, manyAta.validate(x).valid, `twenty filled properties, ${name}: verdict`)
  for (const k of new Set([...Object.getOwnPropertyNames(x), ...Object.getOwnPropertyNames(y)])) {
    const a = x[k]; const b = y[k]
    assert.strictEqual(JSON.stringify(b), JSON.stringify(a), `twenty filled properties, ${name}: ${k}`)
  }
  const inh = Object.getPrototypeOf(y); if (inh && inh !== Object.prototype) assert.strictEqual(JSON.stringify(inh), JSON.stringify(Object.getPrototypeOf(x)), `twenty filled properties, ${name}: the prototype is left alone`)
}
// Forty defaults on one object: the fill sets a bit per default name the
// object has, in two 32-bit words, and writes the defaults whose bit is clear
// (defaultsMask). Held to the current engine in both backends.
const forty = { type: 'object', properties: Object.fromEntries([...Array(40)].map((_, i) => ['o' + i, { default: i % 3 === 0 ? { n: i } : i % 3 === 1 ? 'v' + i : [] }])) }
const fortySrc = specialize(forty, { assertFormat: false, useDefaults: true, verdict: true })
assert.ok(/\{let m0=0,m1=0\n/.test(fortySrc), 'forty defaults: the fill does not use the bit mask, so the case under test did not run')
const fortyMod = new Function('K', functionBody(fortySrc))(K)
const fortyClosures = compileClosures(forty, { assertFormat: false, useDefaults: true })
const fortyAta = new Validator(forty, { useDefaults: true })
const fortyDocs = {
  'empty': () => ({}),
  'all present': () => Object.fromEntries([...Array(40)].map((_, i) => ['o' + i, i])),
  'some present, past the first word': () => ({ o0: 1, o31: 2, o32: 3, o39: 4, other: 5 }),
  'explicit undefined': () => ({ o1: undefined, o35: undefined }),
  'a non-enumerable own name': () => Object.defineProperty({}, 'o33', { value: 'hidden', enumerable: false, writable: true, configurable: true }),
  'an inherited name': () => Object.create({ o2: 'inherited', o34: 'inherited' }),
  'a null prototype': () => Object.assign(Object.create(null), { o3: 'x' }),
}
const dump = (o) => JSON.stringify(Object.getOwnPropertyNames(o).sort().map((k) => [k, o[k] === undefined ? '<undef>' : o[k], Object.prototype.propertyIsEnumerable.call(o, k)]))
for (const [name, make] of Object.entries(fortyDocs)) {
  const x = make(); const y = make(); const z = make()
  fortyAta.validate(x); fortyMod.validate(y); fortyClosures.validate(z)
  assert.strictEqual(dump(y), dump(x), `forty defaults, ${name}: module`)
  assert.strictEqual(dump(z), dump(x), `forty defaults, ${name}: closures`)
}
// Each filled object value is a copy of its own.
const a = {}; const b = {}; fortyMod.validate(a); fortyMod.validate(b); assert.notStrictEqual(a.o0, b.o0, 'forty defaults: an object default is shared between documents')
console.log(`ok: the default fill matches the current engine on ${Object.keys(docs).length + Object.keys(manyDocs).length + Object.keys(fortyDocs).length} kinds of object`)
