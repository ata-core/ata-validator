// A schema that reaches itself on the same value (an allOf whose first entry
// refers back to the node holding it, as SchemaStore's cloudify schema does)
// sent the IR's generated module and its closures into unbounded recursion: a
// RangeError where the current engine answers. The current engine cuts a
// reference it meets again with the same value, the inner entry adding no
// error; calls on such a cycle are marked in lib/ir/front.mjs and both
// backends do the same. Each schema here is held to the interpreted engine's
// verdicts and error lists, in the module and in the closures.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { compileClosures } from '../lib/ir/index.mjs'
import * as K from '../lib/kernels/index.mjs'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')

const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message])])
const cases = {
  'allOf back to its own node': [{ type: 'object', definitions: { X: { type: 'object', allOf: [{ $ref: '#/definitions/X' }, { properties: { a: { type: 'string' } } }] } }, properties: { x: { $ref: '#/definitions/X' } } }, [{ x: { a: 's' } }, { x: { a: 1 } }, { x: 5 }, {}]],
  'a cycle through anyOf and allOf': [{ $defs: { A: { anyOf: [{ $ref: '#/$defs/B' }, { type: 'string' }] }, B: { allOf: [{ $ref: '#/$defs/A' }], minLength: 2 } }, $ref: '#/$defs/A' }, ['x', 'xy', 3, null]],
  'oneOf back to its own node, with properties': [{ $defs: { n: { type: 'object', properties: { c: { $ref: '#/$defs/n' } }, oneOf: [{ $ref: '#/$defs/n' }, { required: ['z'] }] } }, $ref: '#/$defs/n' }, [{}, { z: 1 }, { c: { z: 1 } }, { c: 4 }, 4]],
  'not of itself': [{ $defs: { n: { not: { $ref: '#/$defs/n' } } }, $ref: '#/$defs/n' }, [1, 'a', null]],
}
let checked = 0
for (const [name, [schema, docs]] of Object.entries(cases)) {
  const ref = new Validator(schema, { engine: 'interpreter' })
  const mod = new Function('K', functionBody(specialize(schema, { verdict: true })))(K)
  const clo = compileClosures(schema, {})
  for (const d of docs) {
    const want = shape(ref.validate(d)); const verdict = ref.isValidObject(d)
    for (const [label, m] of [['module', mod], ['closures', clo]]) {
      assert.strictEqual(shape(m.validate(structuredClone(d))), want, `${name}, ${label}, ${JSON.stringify(d)}: errors`)
      assert.strictEqual(m.isValid(structuredClone(d)), verdict, `${name}, ${label}, ${JSON.stringify(d)}: verdict`)
      checked++
    }
  }
}
console.log(`ok: calls on a cycle answer as the current engine in the module and the closures (${checked} checks)`)
