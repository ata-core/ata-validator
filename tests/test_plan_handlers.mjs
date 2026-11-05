// The plan handlers added for schemas forms use (anyOf, oneOf,
// patternProperties, propertyNames, contains, dependentSchemas, the shared
// default pass, names the engine ignores), each held to the current engine
// on documents chosen for its edges: both error shapes, verdicts and the
// document after defaults, as a plan over the wire. And what a plan must
// still refuse: a keyword the engine honours and no handler runs.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { tablePlan } from '../lib/ir/table.mjs'
import { fromPlan } from '../lib/kernels/plan.mjs'
import { fromPlan as fromRich } from '../lib/kernels/plan-rich.mjs'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { compile as compileClosures } from '../lib/ir/run.mjs'
import { MEANINGFUL } from '../lib/ir/front.mjs'
import * as K from '../lib/kernels/index.mjs'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')

const FIELDS = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'expected', 'received', 'detail', 'suggestion', 'related', 'rank']
const shape = (r, d) => JSON.stringify([r.valid, (r.errors || []).map((e) => FIELDS.map((f) => e[f] === undefined ? '<u>' : e[f])), d])

const cases = [
  ['anyOf with titles', { type: 'object', properties: { contact: { anyOf: [{ type: 'string', format: 'email', title: 'an email' }, { type: 'object', properties: { phone: { type: 'string', pattern: '^\\+?[0-9 ]{7,}$' } }, required: ['phone'], title: 'a phone' }] } }, required: ['contact'] },
    [{ contact: 'a@b.co' }, { contact: { phone: '+90 5551234567' } }, { contact: 'nope' }, { contact: { phone: 'x' } }, { contact: 5 }, {}]],
  ['oneOf matched twice', { oneOf: [{ type: 'object', properties: { kind: { const: 'card' }, number: { type: 'string', minLength: 12 } }, required: ['kind', 'number'] }, { type: 'object', properties: { kind: { const: 'iban' }, iban: { type: 'string', minLength: 15 } }, required: ['kind', 'iban'] }, { type: 'object', properties: { note: { type: 'string' } } }] },
    [{ kind: 'card', number: '123456789012' }, { kind: 'card', number: '1' }, { note: 'n' }, { kind: 'card', number: '123456789012', note: 'both' }, { kind: 'x' }, 7]],
  ['a branch that refers back', { type: 'object', properties: { items: { type: 'array', items: { anyOf: [{ type: 'integer', minimum: 0 }, { $ref: '#' }] } } }, additionalProperties: false },
    [{ items: [1, 2] }, { items: [1, -1] }, { items: [{ items: [3] }] }, { items: [{ items: ['s'] }] }, { items: ['s'], extra: 1 }]],
  ['patternProperties beside additionalProperties false', { type: 'object', properties: { id: { type: 'integer' } }, patternProperties: { '^x-': { type: 'string' }, '^meta/': { type: 'number', minimum: 0 } }, additionalProperties: false },
    [{ id: 1, 'x-a': 's', 'meta/k': 2 }, { id: 'no', 'x-a': 1, 'meta/k': -1, other: 1 }, { 'x-': 'ok', extra: null }, {}, 3]],
  ['patternProperties beside a schema', { type: 'object', properties: { id: { type: 'integer' } }, patternProperties: { '^x-': { type: 'string', maxLength: 3 } }, additionalProperties: { type: 'boolean' } },
    [{ id: 1, 'x-a': 'abc', flag: true }, { 'x-a': 'abcd', flag: 'no', id: 1.5 }, { 'x-a': undefined }, JSON.parse('{"__proto__": 1}')]],
  ['a pattern with ~ and /', { type: 'object', patternProperties: { 'a~b/': { type: 'string' }, '^[0-9]+$': { type: 'integer' } } },
    [{ 'a~b/': 's', 12: 7 }, { 'a~b/': 1, 12: 'x' }, { 'xa~b/x': 'ok' }]],
  ['propertyNames', { type: 'object', propertyNames: { type: 'string', pattern: '^[a-z_]+$', maxLength: 5 }, additionalProperties: { type: 'integer' } },
    [{ ab: 1 }, { ab: 'no' }, { ABC: 1 }, { toolong: 1 }, { a_b: 2, 'c-d': 3 }]],
  ['contains with bounds', { type: 'array', contains: { type: 'string' }, minContains: 2, maxContains: 3 },
    [['a', 'b'], ['a'], ['a', 'b', 'c', 'd'], [1, 2], ['a', 1, 'b', 2], 'x']],
  ['contains with minContains 0', { type: 'array', contains: { const: 1 }, minContains: 0 }, [[], [2], [1, 1]]],
  ['dependentSchemas', { type: 'object', properties: { card: { type: 'string' }, cvv: { type: 'string' } }, dependentSchemas: { card: { required: ['cvv'], properties: { cvv: { minLength: 3 } } }, 'a/b': { type: 'object', maxProperties: 2 } } },
    [{ card: '4111', cvv: '123' }, { card: '4111' }, { card: '4111', cvv: '1' }, { 'a/b': 1, x: 2, y: 3 }, { cvv: '1' }, 5]],
  ['draft-7 dependencies', { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', dependencies: { a: ['b'], c: { properties: { d: { type: 'integer' } } } } },
    [{ a: 1, b: 2 }, { a: 1 }, { c: 1, d: 'x' }, { c: 1, d: 2 }]],
  ['names the engine ignores', { type: 'object', 'x-vendor': { any: 1 }, tsType: 'Foo', properties: { id: { type: 'integer', markdownDescription: '**id**', 'x-ui': { widget: 'number' } }, scope: { type: 'string', enum: ['a', 'b'], scope: 'x' } }, required: ['id'], additionalProperties: false },
    [{ id: 1, scope: 'a' }, { id: 'x' }, { id: 1, scope: 'z', extra: 1 }, {}]],
  ['a default under additionalProperties', { type: 'object', properties: { id: { type: 'integer', default: 1 } }, additionalProperties: { type: 'object', properties: { on: { type: 'boolean', default: true } } } },
    [{}, { k: {} }, { id: 2, k: { on: false }, m: {} }, { k: 's' }]],
  ['a default under a pattern', { type: 'object', patternProperties: { '^x-': { type: 'object', properties: { n: { type: 'integer', default: 0 } }, required: ['n'] } } },
    [{ 'x-a': {} }, { 'x-a': { n: 2 }, y: {} }, { 'x-b': { n: 's' } }]],
  ['a cycle of defaults', { $defs: { node: { type: 'object', properties: { v: { type: 'integer', default: 7 }, next: { $ref: '#/$defs/node' } } } }, $ref: '#/$defs/node' },
    [{}, { next: {} }, { next: { next: { v: 1 } } }]],
  ['propertyDependencies', { type: 'object', properties: { kind: { type: 'string' }, n: {}, iban: { type: 'string' } }, propertyDependencies: { kind: { card: { required: ['n'], properties: { n: { type: 'integer', minimum: 1 } } }, iban: { required: ['iban'] }, 'a/b~c': { maxProperties: 1 } }, other: 'not an object, ignored' } },
    [{ kind: 'card', n: 1 }, { kind: 'card' }, { kind: 'card', n: 0 }, { kind: 'iban' }, { kind: 'iban', iban: 'TR' }, { kind: 'a/b~c', n: 1 }, { kind: 'none' }, { kind: 5 }, { n: 1 }, {}, 'x']],
]

let checks = 0
for (const [name, schema, docs] of cases) {
  for (const rich of [false, true]) {
    const plan = tablePlan(schema, { richErrors: rich })
    assert.notStrictEqual(plan, null, `${name}: the plan writer refused it`)
    const page = rich ? await fromRich(JSON.parse(JSON.stringify(plan))) : await fromPlan(JSON.parse(JSON.stringify(plan)))
    const engine = new Validator(schema, { richErrors: rich })
    for (const d of docs) {
      const a = structuredClone(d); const b = structuredClone(d)
      assert.strictEqual(shape(page.validate(a), a), shape(engine.validate(b), b), `${name} (${rich ? 'rich' : 'plain'}): ${JSON.stringify(d)}`)
      assert.strictEqual(page.isValid(structuredClone(d)), engine.validate(structuredClone(d)).valid, `${name}: verdict on ${JSON.stringify(d)}`)
      checks++
    }
  }
}

// The module writer and the closures on the same schemas and documents,
// against the engine: a handler added to the plan is added to the front end
// first, and the two other backends read that front end.
const loadModule = (src) => new Function('K', functionBody(src))(K)
let backends = 0
for (const [name, schema, docs] of cases) {
  for (const rich of [false, true]) {
    const engine = new Validator(schema, { richErrors: rich })
    const mod = loadModule(specialize(schema, { richErrors: rich }))
    const clo = compileClosures(schema, { richErrors: rich })
    for (const d of docs) {
      const a = structuredClone(d); const b = structuredClone(d); const c = structuredClone(d)
      const want = shape(engine.validate(a), a)
      assert.strictEqual(shape(mod.validate(b), b), want, `${name} (${rich ? 'rich' : 'plain'}, module): ${JSON.stringify(d)}`)
      assert.strictEqual(shape(clo.validate(c), c), want, `${name} (${rich ? 'rich' : 'plain'}, closures): ${JSON.stringify(d)}`)
      backends += 2
    }
  }
}

// Every keyword the engine's record names is one the front end knows, so a
// name the engine honours can never be skipped as noise by any backend
// (propertyDependencies was, once).
const record = /const KEYWORD_RECORD = \(\) => \(\{([^}]*)\}\)/s.exec(fs.readFileSync(new URL('../lib/interpreter-core.js', import.meta.url), 'utf8'))[1]
const engineKeywords = [...record.matchAll(/([$\w-]+|'[^']+'):/g)].map((m) => m[1].replace(/'/g, ''))
const unknownToFront = engineKeywords.filter((k) => !MEANINGFUL.has(k))
assert.deepStrictEqual(unknownToFront, [], `keywords the engine honours and the front end would skip: ${unknownToFront.join(', ')}`)

console.log(`ok: the plan handlers answer as the engine on ${checks} checks over ${cases.length} schemas, both shapes; the module writer and the closures on ${backends} more; every engine keyword (${engineKeywords.length}) is one the front end knows`)
