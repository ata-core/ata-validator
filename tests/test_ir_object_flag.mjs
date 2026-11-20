// The IR module declares a node's object flag only for the object keywords it
// lists. propertyDependencies and draft-7 dependencies were not among them, so
// a schema whose node had one of them and no other object keyword threw
// "o5 is not defined" on every value. Both IR backends must answer as the
// interpreted engine on such schemas.
import assert from 'node:assert'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Validator } = require('..')
const ir = await import('../lib/ir/index.mjs')
const K = await import('../lib/kernels/index.mjs')
const { functionBody } = await import('../lib/ir/emit.mjs')

const cases = [
  [{ $schema: 'https://json-schema.org/v1', propertyDependencies: { a: { x: false, y: { required: ['b'] } } } }, [{ a: 'x' }, { a: 'y' }, { a: 'y', b: 1 }, { a: 'z' }, { a: 1 }, {}, [], 'a', null]],
  [{ $schema: 'http://json-schema.org/draft-07/schema#', dependencies: { a: ['b'] } }, [{ a: 1 }, { a: 1, b: 2 }, { b: 2 }, {}, [], 3]],
  [{ $schema: 'http://json-schema.org/draft-07/schema#', dependencies: { a: { required: ['b'] } } }, [{ a: 1 }, { a: 1, b: 2 }, {}, null]],
]
let n = 0
for (const [schema, docs] of cases) {
  const ref = new Validator(schema, { engine: 'interpreter' })
  const mod = new Function('K', functionBody(ir.specialize(schema, { verdict: true })))(K) // eslint-disable-line no-new-func
  const clo = ir.compileClosures(schema, {})
  for (const d of docs) {
    const want = ref.validate(d).valid
    for (const [name, e] of [['ir module', mod], ['ir closures', clo]]) {
      assert.strictEqual(e.isValid(d), want, `${name} isValid ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
      assert.strictEqual(e.validate(d).valid, want, `${name} validate ${JSON.stringify(schema)} on ${JSON.stringify(d)}`)
      n++
    }
  }
}
console.log(`ok: IR answers as the interpreted engine on ${n} propertyDependencies and dependencies cases`)
