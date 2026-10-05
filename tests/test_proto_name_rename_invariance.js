'use strict'

// A schema and a document that use "__proto__" as a name (a property, a
// definition, a dependency, even a keyword) answer exactly as the same pair
// with that name renamed to an ordinary one, on every engine and every read.
// Copies of a schema made by assignment lost such a key: assigning
// "__proto__" sets the copy's prototype instead of creating the property, so
// the constraint was gone and the copy accepted what the schema rejects
// (a property with a reference the resolver rewrites, a reference to the
// property, draft-07 `dependencies`; 1.40.1 to 1.43.0). The interpreter is not
// the reference here, since it shared some of those copies; the renamed
// schema is.

const assert = require('node:assert')
const { Validator } = require('..')
const P = '__proto__', R = 'proto_x'
const ren = (text) => text.split('"' + P + '"').join('"' + R + '"').split('/' + P).join('/' + R)
const S = (o) => JSON.stringify(o).split('"PP"').join('"' + P + '"').split('/PP').join('/' + P)
const schemas = [
  { type: 'object', properties: { PP: { type: 'number' } } },
  { type: 'object', properties: { PP: { type: 'number' } }, required: ['PP'] },
  { $id: 'http://e.x/root', type: 'object', $defs: { S: { $id: 's', type: 'string' } }, properties: { PP: { type: 'number' }, r: { $ref: 's' } } },
  { type: 'object', properties: { PP: { type: 'number' }, r: { $ref: '#/properties/PP' } } },
  { $id: 'http://e.x/root', type: 'object', $defs: { S: { $id: 's', type: 'object', properties: { PP: { type: 'number' } } } }, properties: { r: { $ref: 's' } } },
  { type: 'object', $defs: { K: { type: 'string', maxLength: 20 } }, propertyNames: { $ref: '#/$defs/K' }, properties: { PP: { type: 'number' } } },
  { type: 'object', $defs: { PP: { type: 'number' } }, properties: { a: { $ref: '#/$defs/PP' } } },
  { type: 'object', dependentRequired: { PP: ['a'] }, properties: { a: { const: 1 } } },
  { type: 'object', dependentSchemas: { PP: { required: ['a'] } } },
  { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', dependencies: { PP: ['a'] } },
  { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', dependencies: { PP: { required: ['a'] } } },
  { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', definitions: { D: { type: 'object', properties: { PP: { type: 'integer' } } } }, properties: { o: { $ref: '#/definitions/D' } } },
  { type: 'object', properties: { PP: { type: 'string', format: 'email' } } },
  { type: 'object', properties: { PP: { type: 'string', default: 'd' }, a: { type: 'integer' } } },
  { type: 'object', properties: { PP: { type: 'object', properties: { x: { type: 'integer' } }, additionalProperties: false } }, additionalProperties: false },
  { type: 'object', patternProperties: { '^a': { type: 'integer' } }, properties: { PP: { type: 'number' } }, unevaluatedProperties: false },
  { type: 'object', allOf: [{ properties: { PP: { type: 'number' } } }], unevaluatedProperties: false },
  { type: 'object', oneOf: [{ properties: { PP: { const: 1 } }, required: ['PP'] }, { properties: { PP: { const: 2 } }, required: ['PP'] }] },
  { type: 'array', items: { type: 'object', properties: { PP: { type: 'array', items: { type: 'integer' } } } } },
  { type: 'object', PP: { type: 'string', not: {} }, properties: { a: { type: 'integer' } } },
  { type: 'object', properties: { a: { PP: { not: {} }, type: 'integer' } } },
  { type: 'object', patternProperties: { 'proto': { type: 'number' } } },
  { type: 'object', properties: { PP: false } },
  { type: 'object', not: { required: ['PP'] } },
  { type: 'object', if: { required: ['PP'] }, then: { properties: { PP: { type: 'integer' } } }, else: { required: ['a'] } },
  { type: 'object', properties: { PP: { $ref: '#/$defs/N' } }, $defs: { N: { type: 'number', minimum: 0 }, N2: { type: 'object' } }, $id: 'http://e.x/r2', allOf: [{ $ref: 'http://e.x/r2#/$defs/N2' }] },
]
const docs = ['{}', '{"PP":1}', '{"PP":"s"}', '{"PP":{"x":1}}', '{"PP":{"x":"y","z":1}}', '{"PP":null,"a":2}', '{"PP":1,"a":1}', '{"a":1}', '{"PP":2}', '{"PP":"a@b.co"}',
  '{"o":{"PP":1.5}}', '{"a":1,"PP":-1}', '{"r":{"PP":"s"}}', '{"r":1}', '[{"PP":[1,"x"]},{"PP":[2]}]', '{"PP":1,"abc":2,"q":1}'].map((d) => d.split('"PP"').join('"' + P + '"'))
const { toStandaloneModule } = require('../lib/aot.js')
const fs = require('fs'), os = require('os'), path = require('path'); let aotN = 0, aotPairs = 0
const aotFor = (v) => { try { const src = toStandaloneModule(v, { format: 'cjs' }); if (!src) return null; const f = path.join(os.tmpdir(), 'pinv' + (aotN++) + '.cjs'); fs.writeFileSync(f, src); return require(f) } catch { return null } }
const reads = (v, t) => {
  const d = JSON.parse(t), r = v.validate(d)
  return JSON.stringify({ valid: r.valid, errors: (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.params]), data: d,
    iv: v.isValidObject(JSON.parse(t)), ij: v.isValidJSON(t), vj: v.validateJSON(t).valid, aot: v.__aot ? v.__aot.isValid(JSON.parse(t)) : null })
}
let n = 0, cg = 0
for (const raw of schemas) for (const opts of [{ richErrors: false }, { useDefaults: true, richErrors: false }, { removeAdditional: true, richErrors: false }, { assertFormat: false, richErrors: false }]) for (const engine of [undefined, 'interpreter']) {
  const text = S(raw)
  const o = engine ? { ...opts, engine } : opts
  const v = new Validator(JSON.parse(text), o), w = new Validator(JSON.parse(ren(text)), o)
  for (let k = 0; k < 70; k++) for (const t of docs) { v.validate(JSON.parse(t)); w.validate(JSON.parse(ren(t))) }
  if (!engine && v.engine() === 'codegen') cg++
  if (!engine && !opts.useDefaults && !opts.removeAdditional) { v.__aot = aotFor(new Validator(JSON.parse(text), o)); w.__aot = aotFor(new Validator(JSON.parse(ren(text)), o)); if (!v.__aot || !w.__aot) { v.__aot = null; w.__aot = null } else aotPairs++ }
  for (const t of docs) {
    const a = ren(reads(v, t)), b = reads(w, ren(t)); n++
    assert.strictEqual(a, b, `${engine || v.engine()} ${JSON.stringify(opts)} ${text} on ${t}`)
  }
}
assert.strictEqual(Object.prototype.x, undefined, 'Object.prototype untouched')
assert.strictEqual(({}).a, undefined, 'Object.prototype untouched')
assert.ok(cg >= schemas.length * 3, `expected most validators on generated code, got ${cg} of ${schemas.length * 4}`)
assert.ok(aotPairs >= 30, `expected ahead-of-time modules to compare, got ${aotPairs}`)
console.log(`ok: "__proto__" as a name answers as an ordinary name does (${n} documents, ${cg} of ${schemas.length * 4} validators on generated code, ${aotPairs} module pairs)`)
