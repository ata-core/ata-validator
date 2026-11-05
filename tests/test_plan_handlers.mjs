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

// A keyword the engine honours and no handler runs is refused, never
// skipped: propertyDependencies is in the engine's keyword set.
const honoured = { type: 'object', properties: { kind: { type: 'string' }, n: {} }, propertyDependencies: { kind: { card: { required: ['n'] } } } }
assert.strictEqual(new Validator(honoured).validate({ kind: 'card' }).valid, false, 'the engine honours propertyDependencies')
assert.strictEqual(tablePlan(honoured), null, 'a plan refuses propertyDependencies rather than skipping it')

console.log(`ok: the plan handlers answer as the engine on ${checks} checks over ${cases.length} schemas, both shapes, and a keyword no handler runs is refused`)
