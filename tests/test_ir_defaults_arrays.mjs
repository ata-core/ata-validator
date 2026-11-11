// `properties` applies to objects, and so do the defaults under it: an array
// is not given them as named properties. The Validator's passes were held to
// that in tests/test_defaults_arrays.js; the IR's own fills (the module
// writer's, the closures', the plan's two readers) were not, and went on
// writing them onto arrays, so a page compiled by the build plugin filled a
// document the runtime left alone. Here every IR path is held to the
// Validator on arrays, objects inside arrays, and arrays with names of their
// own, with few defaults and with enough to take each fill's other route
// (the mask from eight defaults, the walk over own names from eight filled
// properties).
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { tableModule, tablePlan, compileClosures } from '../lib/ir/index.mjs'
import { fromPlan } from '../lib/kernels/plan-rich.mjs'
import * as K from '../lib/kernels/index.mjs'
const { Validator } = createRequire(import.meta.url)('../index.js')

const loadTable = (t) => { const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(t); return new Function('K', `const {${m[1]}}=K\n` + t.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + 'return{isValid,validate}')(K) }
const show = (d) => JSON.stringify(d) + JSON.stringify(Object.keys(d))
const many = {}; for (let i = 0; i < 12; i++) many['k' + i] = { default: i }
const deep = {}; for (const k of 'abcdefghi') deep[k] = { properties: { x: { default: 1 } } }
const schemas = [
  { type: 'object', properties: { name: { default: 'anon' }, o: { default: {}, properties: { B: { default: 'b' } } } } },
  { properties: { A: { default: 0 } } },
  { items: { properties: { A: { default: 0 } } } },
  { properties: many },
  { properties: deep },
  { allOf: [{ properties: { A: { default: 0 } } }], prefixItems: [{ properties: { z: { default: 1 } } }] },
]
const docs = () => [[], [1], [{}, 2], [[1], { x: 1 }], {}, { a: [], b: {} }, { o: [] }, Object.assign([1], { a: {} })]

let checked = 0
for (const s of schemas) {
  const paths = { 'module writer': new Function('K', functionBody(specialize(s, { verdict: true })))(K), closures: compileClosures(s, {}) }
  const t = tableModule(s, {})
  if (t !== null) { paths.table = loadTable(t); paths['plan as JSON'] = await fromPlan(JSON.parse(JSON.stringify(tablePlan(s, {})))) }
  for (const [name, m] of Object.entries(paths)) {
    docs().forEach((d, i) => {
      const want = docs()[i]
      new Validator(s).validate(want)
      m.validate(d)
      assert.strictEqual(show(d), show(want), `${name}, ${JSON.stringify(s).slice(0, 70)}: ${JSON.stringify(docs()[i])}`)
      checked++
    })
  }
}
assert.ok(checked >= 150)
console.log(`ok: the IR's fills leave arrays as the Validator does (${checked} documents over 4 paths)`)
