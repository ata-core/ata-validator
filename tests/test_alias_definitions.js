'use strict'

// A definition that is only a reference to another one, `X: { $ref: '#/definitions/XUnion' }`,
// is what TypeScript-to-schema generators emit for a named union. The code
// generator declined every schema containing one, so PostHog's ExperimentMetric
// schema (71 definitions, 4 of them aliases) went to the interpreted engine
// and could not be compiled ahead of time. Aliases are now resolved like any
// other $ref; a chain of aliases that loops declines. Every shape here must
// answer as the interpreted engine does, verdicts and errors, and must not run
// on the interpreter when it has no reason to.

const assert = require('assert')
const { Validator } = require('..')

const Leaf = { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, tag: { enum: ['a', 'b'] } }, required: ['id'], additionalProperties: false }
const shapes = {
  property: { definitions: { X: { $ref: '#/definitions/XU' }, XU: Leaf }, type: 'object', properties: { x: { $ref: '#/definitions/X' } }, required: ['x'] },
  chain: { $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/C' }, C: Leaf }, type: 'object', properties: { x: { $ref: '#/$defs/A' } } },
  root: { $schema: 'http://json-schema.org/draft-07/schema#', $ref: '#/definitions/Top', definitions: { Top: { $ref: '#/definitions/TopU' }, TopU: Leaf } },
  union: { definitions: { M: { $ref: '#/definitions/MU' }, MU: { oneOf: [Leaf, { type: 'string', minLength: 2 }] } }, type: 'array', items: { $ref: '#/definitions/M' } },
  annotated: { definitions: { X: { $ref: '#/definitions/XU', description: 'an alias with a note' }, XU: Leaf }, type: 'object', properties: { x: { $ref: '#/definitions/X' } } },
  recursivePlain: { definitions: { Node: { type: 'object', properties: { v: { type: 'integer' }, kids: { type: 'array', items: { $ref: '#/definitions/Node' } } }, required: ['v'] } }, $ref: '#/definitions/Node' },
  recursive: { definitions: { Node: { $ref: '#/definitions/NodeU' }, NodeU: { type: 'object', properties: { v: { type: 'integer' }, kids: { type: 'array', items: { $ref: '#/definitions/Node' } } }, required: ['v'] } }, $ref: '#/definitions/Node' },
}
const docs = [
  { x: { id: 1 } }, { x: { id: 0 } }, { x: { id: 1, tag: 'c' } }, { x: { id: 1, extra: 1 } }, { x: 'ab' }, {},
  [{ id: 2 }, 'xy', 'x', { id: 0 }], [], { id: 3 }, { id: 3, tag: 'a' }, { v: 1, kids: [{ v: 2, kids: [] }, { kids: [] }] }, { v: 'x' }, null, 5,
]
const shape = (r, withPath) => JSON.stringify(r.valid ? true : r.errors.map((e) => [e.keyword, e.instancePath, withPath ? e.schemaPath : '', e.message]))
// A recursive definition is generated as a function of its own; its errors
// carry the path they were reached by, as the interpreted engine reports it.
// They carried the definition's own path (`#/$defs/Node/required`) before,
// which SchemaStore's web-types schema showed once aliases let it compile.
const PATH_DIFFERS = new Set()

let compared = 0
for (const [name, schema] of Object.entries(shapes)) {
  const fast = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  fast.validate({})
  assert.strictEqual(fast.engine(), 'codegen', `${name} should compile`)
  for (const d of docs) {
    const withPath = !PATH_DIFFERS.has(name)
    assert.strictEqual(shape(fast.validate(structuredClone(d)), withPath), shape(interp.validate(structuredClone(d)), withPath), `${name} on ${JSON.stringify(d)}`)
    assert.strictEqual(fast.isValidObject(structuredClone(d)), interp.isValidObject(structuredClone(d)), `${name} verdict on ${JSON.stringify(d)}`)
    compared++
  }
}

// A loop of aliases has no schema at its end: it stays off the generator.
const loop = { definitions: { A: { $ref: '#/definitions/B' }, B: { $ref: '#/definitions/A' } }, type: 'object', properties: { x: { $ref: '#/definitions/A' } } }
const lv = new Validator(loop)
lv.validate({})
assert.notStrictEqual(lv.engine(), 'codegen', 'an alias loop declines')

console.log(`ok: alias definitions compile and agree with the interpreted engine (${compared} documents over ${Object.keys(shapes).length} shapes)`)
