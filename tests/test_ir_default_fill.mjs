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
console.log(`ok: the module's default fill matches the current engine on ${Object.keys(docs).length} kinds of object`)
