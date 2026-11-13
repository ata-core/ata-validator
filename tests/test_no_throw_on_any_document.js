'use strict'
// A Validator answers for any JSON document; it does not throw. Two shapes of
// generated code read the document before asking what it was, on a schema
// that names no `type`:
//
//   { "unevaluatedItems": false, "anyOf": [{ "items": { "type": "string" } }, true] }
//     read `d.length` to learn how many items a matched branch had evaluated;
//   { "dependentSchemas": { "foo": { "properties": { "bar": {} } } }, "unevaluatedProperties": false }
//     asked whether the document had its own `foo`.
//
// With `null` for a document both threw a TypeError from validate(),
// isValidObject(), validateJSON() and isValidJSON(), where the answer is
// "valid": neither keyword says anything about a value that is not an array
// or an object. A server that validates a request body got an exception in
// place of a verdict for the four-byte body `null`.
//
// The named cases hold the answers; the sweep gives every schema of the
// official suite a document of each JSON type through every method, as a
// first call and as a later one, and none may throw.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { Validator } = require('..')

const methods = ['validate', 'isValidObject', 'validateJSON', 'isValidJSON']
const ask = (v, m, d) => { const r = v[m](m.endsWith('JSON') ? JSON.stringify(d) : structuredClone(d)); return typeof r === 'object' ? r.valid : r }

const named = [
  [{ unevaluatedItems: false, anyOf: [{ items: { type: 'string' } }, true] }, [[null, true], [1, true], ['x', true], [{}, true], [{ length: 3 }, true], [[], true], [['a', 'b'], true], [[1], false]]],
  [{ unevaluatedItems: { type: 'boolean' }, anyOf: [{ items: { type: 'string' } }, true] }, [[null, true], [['a'], true], [[1], false], [[true], true]]],
  [{ unevaluatedItems: false, oneOf: [{ items: { type: 'string' } }, { type: 'object' }] }, [[null, true], [['a'], true], [{}, false], [1, true]]],
  [{ properties: { foo: { type: 'string' } }, dependentSchemas: { foo: { properties: { bar: { const: 'bar' } }, required: ['bar'] } }, unevaluatedProperties: false }, [[null, true], [1, true], ['foo', true], [[], true], [{}, true], [{ foo: 'a', bar: 'bar' }, true], [{ foo: 'a' }, false], [{ bar: 'bar' }, false]]],
  [{ dependentSchemas: { toString: { properties: { a: true } } }, unevaluatedProperties: false }, [[null, true], ['x', true], [{}, true], [{ a: 1 }, false], [{ toString: 1, a: 1 }, false]]],
]
let n = 0
for (const [schema, docs] of named) {
  for (const [d, want] of docs) {
    for (const m of methods) {
      for (const opts of [undefined, { richErrors: false }]) {
        const label = `${m}(${JSON.stringify(d)}) on ${JSON.stringify(schema)}${opts ? ' ' + JSON.stringify(opts) : ''}`
        // As a schema's first call and as a later one: they can be answered
        // by different engines.
        assert.strictEqual(ask(new Validator(structuredClone(schema), opts), m, d), want, label)
        const warm = new Validator(structuredClone(schema), opts)
        ask(warm, m, {}); ask(warm, m, [])
        assert.strictEqual(ask(warm, m, d), want, label + ', a later call')
        n += 2
      }
    }
  }
}

const SUITE = path.join(__dirname, 'suite', 'tests')
const docs = [null, 0, 1.5, '', 'x', true, [], {}, [null], [[]], [{}], { a: null }, { a: [] }, [1, 'a', null, {}, []], { foo: null, bar: null }]
let schemas = 0; let calls = 0
for (const draft of ['draft2020-12', 'draft2019-09', 'draft7', 'draft6', 'draft4']) {
  for (const sub of ['', 'optional']) {
    const dir = path.join(SUITE, draft, sub)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        // A schema the Validator refuses to build (a reference to a document
        // nobody registered) has nothing to call.
        try { new Validator(structuredClone(g.schema)) } catch { continue }
        schemas++
        for (const m of methods) {
          const warm = new Validator(structuredClone(g.schema))
          for (const d of docs) {
            const where = `${draft}/${sub ? sub + '/' : ''}${f}, "${g.description}": ${m}(${JSON.stringify(d)})`
            assert.doesNotThrow(() => ask(new Validator(structuredClone(g.schema)), m, d), where + ' as a first call')
            assert.doesNotThrow(() => ask(warm, m, d), where)
            calls += 2
          }
        }
      }
    }
  }
}
assert.ok(schemas > 1500, 'the suite was read')
console.log(`ok: no document makes a Validator throw, ${n} named answers, ${schemas} suite schemas, ${calls} calls`)
