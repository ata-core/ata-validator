'use strict'

// validateJSON() errors are the same object, field for field and in the same
// order, whichever engine answers: generated code, the interpreter, and the
// interpreted twin that answers a large schema's first calls. The source
// anchor (line and column of the failing value in the text) went missing on
// the interpreter path for a while, because its errors were presented before
// the text layer saw them, and no test compared the whole object.

const assert = require('node:assert')
const { Validator } = require('..')

const big = { type: 'object', properties: {}, required: ['id'] }
for (let i = 0; i < 400; i++) big.properties['field_' + i] = { type: 'string', minLength: 2, description: 'x'.repeat(30) }
big.properties.id = { type: 'integer', minimum: 1 }
const cases = [
  [{ type: 'object', properties: { q: { type: 'number' }, r: { type: 'array', items: { type: 'string' } } }, required: ['q'] },
    ['{"q":"s"}', '{}', '{"q":1,"r":[1,"a",2]}', '{\n  "q": true,\n  "r": "x"\n}']],
  [{ type: 'object', properties: { ['constructor']: { type: 'number' }, toString: { type: 'string' } } },
    ['{"constructor":"s"}', '{"toString":1,"constructor":2}']],
  [{ $defs: { p: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }, type: 'array', items: { $ref: '#/$defs/p' } },
    ['[{"name":1},{},{"name":"ok"}]']],
  [big, ['{"field_3":"a","id":0}', '{"field_399":5}']],
]
let compared = 0
for (const [schema, texts] of cases) {
  const gen = new Validator(schema)
  gen._coldCalls = 64 // past the twin: generated code
  const interp = new Validator(schema, { engine: 'interpreter' })
  for (let r = 0; r < 70; r++) for (const t of texts) void gen.validateJSON(t).errors
  for (const t of texts) {
    const want = JSON.stringify(gen.validateJSON(t).errors)
    assert.ok(want.includes('"anchor"'), `generated errors carry an anchor for ${t}`)
    assert.strictEqual(JSON.stringify(interp.validateJSON(t).errors), want, `interpreter, ${t}`)
    // A fresh validator answers its first call through the twin where the
    // schema is large enough to have one.
    assert.strictEqual(JSON.stringify(new Validator(schema).validateJSON(t).errors), want, `first call, ${t}`)
    compared++
  }
}
// Without enrichment too, and in the order validate() gives: on generated
// code the text path handed out its errors in the order it found them.
const lean = { type: 'object', properties: { p: { type: 'object', properties: { x: { type: 'integer' } } } }, additionalProperties: false }
for (const t of ['{"p":null,"a":2}', '{"a":1,"p":{"x":"s"},"b":2}']) {
  const gen = new Validator(lean, { richErrors: false })
  const interp = new Validator(lean, { richErrors: false, engine: 'interpreter' })
  for (let r = 0; r < 70; r++) void gen.validateJSON(t).errors
  const want = JSON.stringify(gen.validate(JSON.parse(t)).errors)
  assert.strictEqual(JSON.stringify(gen.validateJSON(t).errors), want, `lean generated validateJSON in validate() order, ${t}`)
  assert.strictEqual(JSON.stringify(interp.validateJSON(t).errors), want, `lean interpreter validateJSON, ${t}`)
  compared++
}
console.log(`ok: validateJSON errors are the same object on generated code, the interpreter and the first-call twin (${compared} documents)`)
