'use strict'

// The 2.0 Validator (lib/validator-small.js) against the 1.x Validator for
// what @rjsf/validator-ata and @sjsf/ata-validator use: the `verbose` option
// (parentSchema, schema and data on each error), addSchema(), and the
// schemaPath of each error. On every group of the official suite's draft
// 2020-12 and draft-07 files and every document, the two must return the same
// verdict and errors equal field for field, with the schema given directly
// and with it registered through addSchema() behind a `$ref`, as the form
// libraries do with their root schema.
//
// Errors are compared in both shapes the 2.0 Validator has. Without its
// richErrors feature they equal the 1.x Validator's under `richErrors: false`,
// key set included, and their messages equal its default ones. With the
// feature (here carried by a class, as index.v2.edge.mjs carries it, since
// Validator.use() registers for the whole process) they equal the 1.x
// Validator's default errors.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const OneX = require('..').Validator
const { Validator } = require('../lib/validator-small.js')
const { codegen } = require('../lib/features/codegen.js')
const { metaschemas } = require('../lib/features/metaschemas.js')
const { errorMessages } = require('../lib/features/error-messages.js')
const { richErrors } = require('../lib/features/rich-errors.js')
Validator.use(metaschemas, errorMessages)
class Rich extends Validator {}
Rich.prototype.rich = richErrors

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', draft7: 'http://json-schema.org/draft-07/schema#' }
const clone = (x) => x === undefined ? x : structuredClone(x)
const refused = (e) => e && /^ata2:/.test(String(e.message))

// What a validator says about a document: its verdict, then its errors, or
// the error it threw.
function answer (v, d) {
  try {
    const r = v.validate(clone(d))
    return r.valid ? { valid: true } : { valid: false, errors: r.errors }
  } catch (e) { return { threw: e.constructor.name + ': ' + e.message } }
}

let compared = 0; let declined = 0; let schemas = 0; let messages = 0
// The fields every error keeps without the rich ones, for the messages.
const base = (r) => r.errors ? { ...r, errors: r.errors.map((e) => [e.keyword, e.instancePath, e.schemaPath, e.params, e.message]) } : r
// The 1.x Validator and the 2.0 one, each built by `make`, on every document:
// `V2` with `opts` against the 1.x Validator with `ref`, through `view`.
function compare (label, make, docs, opts, V2 = Rich, ref = opts, view = (r) => r) {
  let a; let b
  try { a = make(OneX, ref) } catch (e) { a = e }
  try { b = make(V2, opts) } catch (e) { if (refused(e)) { declined++; return } b = e }
  if (a instanceof Error || b instanceof Error) {
    assert.ok(a instanceof Error && b instanceof Error, `${label}: both build or both throw (${a instanceof Error ? a.message : 'built'} / ${b instanceof Error ? b.message : 'built'})`)
    assert.strictEqual(b.message, a.message, `${label}: the same error`)
    return
  }
  schemas++
  for (const d of docs) {
    const where = `${label} ${JSON.stringify(opts)}: ${JSON.stringify(d)}`.slice(0, 300)
    const want = view(answer(a, d))
    const got = view(answer(b, d))
    if (got.threw && refused({ message: got.threw.replace(/^Error: /, '') })) { declined++; return }
    assert.deepStrictEqual(got, want, where)
    assert.strictEqual(b.isValidObject(clone(d)), a.isValidObject(clone(d)), where + ': isValidObject')
    if (view === base) messages += got.errors ? got.errors.length : 0
    compared++
  }
}
// Each comparison in the three ways: with the rich fields, without them, and
// the messages without them against the default ones.
function compareAll (label, make, docs, opts) {
  compare(label, make, docs, opts)
  compare(label + ' (no rich fields)', make, docs, opts, Validator, opts.richErrors === undefined ? { ...opts, richErrors: false } : opts)
  if (opts.richErrors === undefined && !opts.abortEarly) compare(label + ' (messages)', make, docs, opts, Validator, opts, base)
}

const SUITE = path.join(__dirname, 'suite/tests')
const OPTS = [{ verbose: true }, { verbose: true, richErrors: false }, { verbose: true, abortEarly: true }, { verbose: false }]
for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const dir = path.join(SUITE, dialect)
  assert.ok(fs.existsSync(dir), dialect + ': the suite is checked out')
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (JSON.stringify(g.schema).includes('localhost:1234')) continue
      const plain = g.schema !== null && typeof g.schema === 'object' && !Array.isArray(g.schema)
      const schema = plain && !('$schema' in g.schema) ? { $schema: uri, ...g.schema } : g.schema
      const docs = g.tests.map((t) => t.data)
      const label = `${dialect}/${f}: ${g.description}`
      for (const opts of OPTS) {
        // The schema itself.
        compareAll(label, (V, o) => new V(schema, o), docs, opts)
        if (!plain) continue
        // Registered with addSchema() and reached through a $ref, as rjsf
        // registers a form's root schema.
        const id = typeof schema.$id === 'string' && schema.$id[0] !== '#' ? schema.$id : 'https://example.com/root.json'
        const doc = id === schema.$id ? schema : { ...schema, $id: id }
        compareAll(label + ' (addSchema)', (V, o) => { const v = new V({ $schema: uri, $ref: id }, o); v.addSchema(doc); return v }, docs, opts)
        // As sjsf: a root without a dialect of its own, read under the
        // validator's draft-07.
        if (dialect === 'draft7') {
          const bare = { ...g.schema }
          delete bare.$schema
          if (typeof bare.$id !== 'string') bare.$id = 'root'
          compareAll(label + ' (addSchema, inherited draft)', (V, o) => { const v = new V({ $schema: uri, $ref: bare.$id }, o); v.addSchema(bare); return v }, docs, opts)
        }
      }
    }
  }
}
assert.ok(schemas > 10000 && compared > 40000 && messages > 4000, `compared ${schemas} validators on ${compared} documents, ${messages} messages`)

// addSchema() itself, as the 1.x Validator has it.
const sameThrow = (f, msg) => {
  let a; let b
  try { f(OneX) } catch (e) { a = e }
  try { f(Validator) } catch (e) { b = e }
  assert.ok(a && b, msg + ': both throw')
  assert.strictEqual(b.constructor, a.constructor, msg)
  assert.strictEqual(b.message, a.message, msg)
}
sameThrow((V) => new V({ type: 'string' }, {}).addSchema({ type: 'string' }), 'no $id')
sameThrow((V) => new V({ type: 'string' }, {}).addSchema(true), 'a boolean schema')
sameThrow((V) => new V({ type: 'string' }, {}).addSchema({ $id: '#frag', type: 'string' }), 'a fragment-only $id is an anchor, not an identity')
sameThrow((V) => new V({ $schema: 'http://json-schema.org/draft-04/schema#', type: 'string' }, {}).addSchema({ id: 'http://x/a', type: 'string' }), "draft-04's `id` alone")
for (const call of ['validate', 'validateJSON', 'isValidJSON']) {
  sameThrow((V) => { const v = new V({ type: 'string' }, {}); v[call](call.endsWith('JSON') ? '"a"' : 'a'); v.addSchema({ $id: 'http://x/a' }) }, 'after ' + call)
}
// After isValidObject() too, with the same message. The 1.x Validator takes
// a document added after an isValidObject() its first-call shortcut answered,
// which compiled nothing; its message names the call all the same.
{
  const v = new Validator({ type: 'string' }, {})
  v.isValidObject('a')
  assert.throws(() => v.addSchema({ $id: 'http://x/a' }), { message: /^Cannot add schema after compilation: call addSchema\(\) before validate\(\), isValidObject\(\)/ })
}
// It replaces a document of the `schemas` option with the same $id.
{
  const make = (V) => { const v = new V({ $ref: 'http://x/a' }, { schemas: [{ $id: 'http://x/a', type: 'string' }], verbose: true }); v.addSchema({ $id: 'http://x/a', type: 'number' }); return v }
  for (const d of ['s', 1]) assert.deepStrictEqual(answer(make(Rich), d), answer(make(OneX), d), 'addSchema over the schemas option: ' + d)
}
// A validator that tiers up to generated code keeps the documents added to it.
Validator.use(codegen)
// Asking for the rich fields by name without the feature is refused, naming it.
assert.throws(() => new Validator({ type: 'string' }, { richErrors: true }).validate(1), { message: 'ata2: richErrors, Validator.use(richErrors)' })
;(async () => {
  // Without the rich fields, and with them: a tiered-up validator keeps both
  // the documents added to it and the shape of its errors.
  const make = (V, o) => { const v = new V({ type: 'object', properties: { a: { $ref: 'http://x/a#/$defs/n' } } }, o); v.addSchema({ $id: 'http://x/a', $defs: { n: { type: 'number', minimum: 3 } } }); return v }
  for (const [V2, opts, ref] of [[Validator, { verbose: true }, { verbose: true, richErrors: false }], [Rich, { verbose: true }, { verbose: true }], [Validator, {}, { richErrors: false }]]) {
    const v = make(V2, opts)
    assert.strictEqual(await v._tierUp(), true, 'tiered up')
    const a = make(OneX, ref)
    for (const d of [{ a: 1 }, { a: 'x' }, { a: 5 }]) assert.deepStrictEqual(answer(v, d), answer(a, d), 'tiered up: ' + JSON.stringify([opts, d]))
  }
  // Registered for the process, the feature gives every validator the rich fields.
  Validator.use(richErrors)
  const s = { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false }
  assert.deepStrictEqual(answer(new Validator(s), { nme: 'abc' }), answer(new OneX(s), { nme: 'abc' }), 'Validator.use(richErrors)')
  assert.ok(answer(new Validator(s), { nme: 'abc' }).errors[0].related, 'typo correlation comes with the feature')
  console.log(`validator-small verbose and addSchema: ${schemas} validators, ${compared} documents equal to the 1.x Validator, ${messages} messages without the rich fields equal to its default ones (${declined} declined)`)
})().catch((e) => { console.error(e); process.exit(1) })
