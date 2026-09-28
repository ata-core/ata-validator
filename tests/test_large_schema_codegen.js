'use strict'

// A large oneOf reached through many $refs is generated once, and a schema
// whose code outgrows the budget goes to another engine instead of being
// generated anyway. SchemaStore's Kestra schema, 7.6 MB with a oneOf of
// several hundred task types referenced from every task list, produced 75 MB
// of code and took 7.3 seconds and 1.6 GB before its first answer.
// Both behaviours are checked against the interpreted engine's answers.

const assert = require('assert')
const { Validator } = require('..')
const jc = require('../lib/js-compiler')

function bigSchema (kinds, sites) {
  const definitions = {}
  for (let i = 0; i < kinds; i++) {
    definitions['T' + i] = { type: 'object', required: ['type', 'id'], properties: { type: { const: 't' + i }, id: { type: 'string', minLength: 1 }, retry: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', pattern: '^[0-9]+s$' }] }, labels: { type: 'object', additionalProperties: { type: 'string' } } }, additionalProperties: false }
  }
  definitions.Task = { oneOf: Object.keys(definitions).map((k) => ({ $ref: '#/definitions/' + k, description: 'a task' })) }
  const properties = {}
  for (let j = 0; j < sites; j++) properties['list' + j] = { type: 'array', items: { $ref: '#/definitions/Task' } }
  return { definitions, type: 'object', properties }
}
const docs = [
  { list0: [{ type: 't3', id: 'x' }] },
  { list5: [{ type: 't3', id: 'x', retry: '5s' }, { type: 't7', id: 'y', retry: 2 }] },
  { list1: [{ type: 't3', id: '' }] },
  { list2: [{ type: 'nope', id: 'x' }] },
  { list3: [{ type: 't1', id: 'x', extra: 1 }] },
  { list4: [{ type: 't9', id: 'x', retry: 'soon', labels: { a: 1 } }] },
  { list0: 'x' },
]
const shape = (r) => JSON.stringify(r.valid ? true : r.errors.map((e) => [e.code, e.keyword, e.instancePath]))
function agree (schema, label) {
  const fast = new Validator(schema), interp = new Validator(schema, { engine: 'interpreter' })
  for (const d of docs) assert.strictEqual(shape(fast.validate(structuredClone(d))), shape(interp.validate(structuredClone(d))), `${label}: ${JSON.stringify(d)}`)
  return fast.engine()
}

// Shared branches: one function per task type however many lists use it.
const shared = bigSchema(150, 40)
assert.strictEqual(agree(shared, 'shared oneOf'), 'codegen')

// Over budget: the generator declines, another engine answers, and the
// answers are the same.
jc._setCodeBudget(2000)
try {
  // A schema not compiled above, so the shared compile cache has no entry for it.
  assert.strictEqual(jc.compileToJSCodegen(bigSchema(150, 41), null, null), null, 'over budget, the generator declines')
  assert.notStrictEqual(agree(bigSchema(150, 41), 'over budget'), 'codegen')
} finally {
  jc._setCodeBudget()
}
console.log('ok: a shared oneOf compiles once, and a schema over the code budget goes to another engine with the same answers')
