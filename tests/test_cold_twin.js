'use strict'

// A large schema's first calls are answered by an interpreted twin, and the
// validator compiles once it is still in use (coldTwin in index.js). This
// holds the twin's answers to the interpreter's, across the four entry points
// sharing one count, defaults written into the document included; checks the
// switch to generated code happens after the cold calls and not before; and
// checks a small schema and an extended validator keep compiling at once.

const assert = require('node:assert')
const { Validator } = require('..')

const $defs = { item: { type: 'object', properties: {}, required: ['id'] } }
for (let i = 0; i < 40; i++) $defs.item.properties['f' + i] = { type: 'string', minLength: 2, default: 'dd' }
$defs.item.properties.id = { type: 'integer', minimum: 1 }
const properties = {}
for (let i = 0; i < 30; i++) properties['p' + i] = { $ref: '#/$defs/item' }
const big = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties, $defs }
const docs = [{ p0: { id: 1 } }, { p0: { id: 0, f1: 'x' } }, { p3: {} }, 'nope', { p9: { id: 2, f2: 'abc' } }]
const shape = (r) => JSON.stringify({ valid: r.valid, errors: (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath]) })

// The twin answers, and the answers are the interpreter's.
{
  const v = new Validator(big)
  const it = new Validator(big, { engine: 'interpreter' })
  for (let round = 0; round < 3; round++) {
    for (const d of docs) {
      const a = structuredClone(d), b = structuredClone(d)
      assert.strictEqual(shape(v.validate(a)), shape(it.validate(b)), 'validate on ' + JSON.stringify(d))
      assert.deepStrictEqual(a, b, 'defaults written the same way')
      assert.strictEqual(v.isValidObject(structuredClone(d)), it.isValidObject(structuredClone(d)))
      assert.strictEqual(v.isValidJSON(JSON.stringify(d)), it.isValidJSON(JSON.stringify(d)))
      assert.strictEqual(shape(v.validateJSON(JSON.stringify(d))), shape(it.validateJSON(JSON.stringify(d))))
    }
  }
  assert.ok(v._twin, 'a large schema has a twin')
  assert.strictEqual(v._initialized, false, 'nothing compiled during the cold calls')
  assert.strictEqual(v._coldCalls, 60, 'the four entry points share one count')
  // Past the cold calls it compiles and keeps the same answers.
  for (let i = 0; i < 10; i++) v.validate({ p0: { id: 1 } })
  assert.strictEqual(v._initialized, true, 'compiled after the cold calls')
  assert.strictEqual(v.engine(), 'codegen')
  for (const d of docs) assert.strictEqual(shape(v.validate(structuredClone(d))), shape(it.validate(structuredClone(d))), 'after compiling, ' + JSON.stringify(d))
}

// A small schema compiles at its first call, as before.
{
  const v = new Validator({ type: 'object', properties: { a: { type: 'integer' } } })
  v.validate({ a: 1 })
  assert.strictEqual(v._initialized, true)
  assert.ok(!v._twin)
}

// An extension registered before the first call keeps the validator off the twin.
{
  // A copy: the same schema object without options would hand back the
  // validator above, from the identity cache.
  const v = new Validator(structuredClone(big))
  v._extendValidate(() => ({ check: (d) => !(d && d.reject), errors: () => [{ keyword: 'ext', instancePath: '', schemaPath: '#', params: {}, message: 'rejected by extension' }] }))
  assert.strictEqual(v.validate({ reject: true }).valid, false, 'the extension applies from the first call')
  assert.ok(!v._twin)
}
console.log('ok: a large schema starts on its interpreted twin with the same answers, and compiles once it stays in use')
