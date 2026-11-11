// Errors and defaults behind a reference that leaves the document: a schema
// registered with `schemas`, or an official meta-schema. Every IR path is
// held to the Validator on both.
//
// Found by scripts/gate.js, reported by no test until this one:
//   - the order skeleton an IR module sorts by held the schema's own document
//     only, so an error behind a registered schema had no rank and came in
//     the order the checks ran (every error of item 0, then of item 1, where
//     the Validator reports check by check);
//   - the Validator registered its documents for ordering before it loaded
//     the meta-schemas, so errors behind a reference to one came in the order
//     the checks ran, not the order the meta-schema declares;
//   - the IR's fill followed every reference into a registered document and
//     was not written at all when the schema's own text had no default,
//     where the Validator fills from the root's reference and its
//     properties' references, one step: more filled in one place, nothing in
//     another.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { tableModule, tablePlan, compileClosures } from '../lib/ir/index.mjs'
import { fromPlan } from '../lib/kernels/plan-rich.mjs'
import * as K from '../lib/kernels/index.mjs'
const { Validator } = createRequire(import.meta.url)('../index.js')



const loadTable = (t) => { const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(t); return new Function('K', `const {${m[1]}}=K\n` + t.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + 'return{isValid,validate}')(K) }
const FIELDS = ['code', 'keyword', 'instancePath', 'schemaPath', 'message']
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => FIELDS.map((f) => e[f]))])
const show = (d) => (d !== null && typeof d === 'object' ? JSON.stringify(d) + JSON.stringify(Object.keys(d)) : JSON.stringify(d))

const t = { $id: 'https://e.x/t', type: 'object', properties: { a: { type: 'string', default: 'A' }, b: { minimum: 3 }, n: { $ref: 'https://e.x/u' } }, required: ['c'] }
const u = { $id: 'https://e.x/u', type: 'object', properties: { b: { default: 2 } } }
const many = { $id: 'https://e.x/m', type: 'object', properties: {} }
for (let i = 0; i < 12; i++) many.properties['f' + i] = { type: 'integer' }
const registered = [t, u, many]
const M20 = 'https://json-schema.org/draft/2020-12/schema'
const M19 = 'https://json-schema.org/draft/2019-09/schema'
const M7 = 'http://json-schema.org/draft-07/schema#'

const cases = [
  [{ type: 'array', items: { $ref: 'https://e.x/t' } }, registered],
  [{ $ref: 'https://e.x/t' }, registered],
  [{ $ref: 'https://e.x/t', $defs: { q: { default: 9 } } }, registered],
  [{ $ref: 'https://e.x/t', properties: { x: { default: 1 } } }, registered],
  [{ properties: { x: { default: 1 } }, allOf: [{ $ref: 'https://e.x/t' }] }, registered],
  [{ properties: { p: { $ref: 'https://e.x/t' } } }, registered],
  [{ properties: { p: { $ref: 'https://e.x/t' }, x: { default: 1 } } }, registered],
  [{ properties: { l: { items: { $ref: 'https://e.x/t' } }, x: { default: 1 } } }, registered],
  [{ properties: { z: { $ref: 'https://e.x/t' }, a: { type: 'string' } } }, registered],
  [{ $ref: 'https://e.x/m' }, registered],
  // A reference beside keywords of its own, in one document: `#/required` ranks before `#/properties/a/type`.
  [{ $ref: '#/$defs/t', properties: { x: { type: 'integer' } }, $defs: { t: { type: 'object', properties: { a: { type: 'string' } }, required: ['c'] } } }, null],
  [{ $ref: M20 }, null],
  [{ $schema: M19, $ref: M19 }, null],
  [{ $schema: M7, $ref: M7 }, null],
  [{ $schema: 'http://json-schema.org/draft-06/schema#', $ref: 'http://json-schema.org/draft-06/schema#' }, null],
  [{ $schema: 'http://json-schema.org/draft-04/schema#', $ref: 'http://json-schema.org/draft-04/schema#' }, null],
]
const docs = () => [
  {}, 1, [], [{}], [{ a: 1, b: 1 }, { a: 2, b: 0 }], { a: 1, b: 1, c: 1 }, { p: { n: {} }, n: {}, l: [{}] }, { a: 1, z: { b: 1, a: 1 } },
  { f9: 'x', f2: 'y', f5: 'z' }, { multipleOf: 0 }, { exclusiveMaximum: true }, { maximum: 3, exclusiveMaximum: true }, { a: 1 }, { $defs: { foo: { type: 'integer' } } }, { $defs: { foo: { type: 1 } } }, { minLength: -1, type: 'nope' },
]

let checked = 0
const seen = new Set()
for (const [s, schemas] of cases) {
  for (const useDefaults of [true, false]) {
    const o = schemas ? { schemas, useDefaults } : { useDefaults }
    const paths = { 'module writer': new Function('K', functionBody(specialize(s, { verdict: true, ...o })))(K), closures: compileClosures(s, o) }
    const tm = tableModule(s, o)
    if (tm !== null) { paths.table = loadTable(tm); paths['plan as JSON'] = await fromPlan(JSON.parse(JSON.stringify(tablePlan(s, o)))) }
    const v = new Validator(s, o)
    for (const [name, m] of Object.entries(paths)) {
      seen.add(name)
      docs().forEach((d, i) => {
        const w = docs()[i]
        const want = v.validate(w)
        const got = m.validate(d)
        const where = `${name}, ${JSON.stringify(s).slice(0, 80)}, useDefaults ${useDefaults}: ${JSON.stringify(docs()[i])}`
        assert.strictEqual(shape(got), shape(want), where)
        assert.strictEqual(show(d), show(w), where + ': the document afterwards')
        checked++
      })
    }
  }
}

// The Validator itself: behind a meta-schema, the order it declares (allOf before type).
const order = new Validator({ $ref: M20 }, { useDefaults: false }).validate(1).errors.map((e) => e.schemaPath)
assert.strictEqual(order[0], '#/allOf/0/type')
assert.strictEqual(order[order.length - 1], '#/type')
for (const engine of ['interpreter']) assert.deepStrictEqual(new Validator({ $ref: M20 }, { useDefaults: false, engine }).validate(1).errors.map((e) => e.schemaPath), order)

// The table backend declines a schema whose reference leaves the document; it is compared when it takes one.
assert.ok(seen.has('module writer') && seen.has('closures'), [...seen].join())
assert.ok(checked >= 600, String(checked))
console.log(`ok: errors and defaults behind registered schemas and meta-schemas, as the Validator gives them (${checked} documents over ${seen.size} paths)`)
