// The closure backend answers a verdict on an object with fewer own names
// than its schema lists by visiting the object's names (lib/ir/run.mjs,
// 'props'). An entry runs for every own name, enumerable or not, and for no
// inherited one, which is what the lookup per name did. These objects are the
// ones a walk over the wrong set of names would get wrong.
import assert from 'node:assert'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')
const { compileClosures } = await import('../lib/ir/index.mjs')

const props = {}
for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'toString', 'constructor']) props[k] = { type: 'string' }
const schema = { type: 'object', properties: props }
const ir = compileClosures(schema, {})
const ata = new Validator(schema)

const nonEnumerable = {}
Object.defineProperty(nonEnumerable, 'a', { value: 5, enumerable: false })
const cases = {
  'a non-enumerable own name': [nonEnumerable, false],
  'a name inherited from a custom prototype': [Object.create({ b: 5 }), true],
  'a null prototype': [Object.assign(Object.create(null), { c: 5 }), false],
  'an own name Object.prototype also has': [{ toString: 5 }, false],
  'valid, with a name the schema does not list': [{ a: 'x', z: 1 }, true],
  'many names, one listed and wrong': [Object.fromEntries([...Array(20)].map((_, i) => ['k' + i, i]).concat([['f', 1]])), false],
  'a symbol key': [{ [Symbol('a')]: 5, a: 'x' }, true],
}
for (const [name, [doc, want]] of Object.entries(cases)) {
  assert.strictEqual(ata.isValidObject(doc), want, `current engine, ${name}`)
  assert.strictEqual(ir.isValid(doc), want, `IR closures, ${name}`)
  assert.strictEqual(ir.validate(doc).valid, want, `IR closures validate(), ${name}`)
}
console.log(`ok: the closures' key walk answers as the current engine on ${Object.keys(cases).length} edge objects`)
