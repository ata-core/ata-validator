'use strict'

// The 2.0 entries over a Validator's life. With the schema left as it was
// given, the server and edge entry (the verdict core) answers as the browser
// entry (the small engine) and as the 1.x Validator, with isValidObject or
// validate called first, and the two methods agree. A pattern that does not
// compile is thrown where it is reached, as the browser entry does, and not
// where it is not. Loading the edge entry leaves the browser entry's
// Validator on the small engine.
//
// The schema is read-only once a Validator is built from it (docs/API.md):
// a change made to it afterwards is unsupported input. The changes below are
// still run, to hold that such input is answered without an error, but their
// answers are not compared.

const assert = require('node:assert')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const OneX = require('..').Validator

const answer = (f) => { try { const r = f(); return typeof r === 'boolean' ? r : r.valid } catch (e) { return 'throws ' + e.constructor.name } }

const cases = [
  ['type deleted', { type: 'string' }, (s) => { delete s.type }, ['a', 1]],
  ['keyword added', { type: 'object' }, (s) => { s.required = ['a'] }, [{}, { a: 1 }]],
  ['bound changed', { type: 'string', maxLength: 3 }, (s) => { s.maxLength = 1 }, ['abc', 'abcd', 'a']],
  ['$defs target replaced', { $defs: { a: { type: 'string' } }, properties: { x: { $ref: '#/$defs/a' } } }, (s) => { s.$defs.a = { type: 'number' } }, [{ x: 'y' }, { x: 1 }]],
  ['$defs target changed in place', { $defs: { a: { type: 'string', minLength: 2 } }, type: 'object', properties: { x: { $ref: '#/$defs/a' } } }, (s) => { s.$defs.a.minLength = 5 }, [{ x: 'yy' }, { x: 'y' }, { x: 1 }]],
  ['properties emptied', { type: 'object', properties: { a: { type: 'integer' } }, additionalProperties: false }, (s) => { s.properties = {} }, [{ a: 1 }, { a: 's' }, { b: 1 }]],
]

// Each case: answers after the mutation, from a Validator first called with
// one method; every answer is asked of both methods.
function run (V, schema0, mutate, docs, first) {
  const s = structuredClone(schema0)
  const v = new V(s)
  const head = first === 'validate' ? answer(() => v.validate(structuredClone(docs[0]))) : answer(() => v.isValidObject(structuredClone(docs[0])))
  mutate(s)
  const out = [head]
  for (const d of docs) out.push([answer(() => v.validate(structuredClone(d))), answer(() => v.isValidObject(structuredClone(d)))])
  return out
}

const patterns = [
  ['unreached bad pattern', { $defs: { x: { pattern: '(' } }, type: 'string' }],
  ['reached bad pattern', { type: 'string', pattern: '(' }],
]
function patternRun (V, schema, first) {
  const v = new V(schema)
  const out = []
  for (const d of first === 'validate' ? ['a', 1, 'b'] : [1, 'a', 2]) {
    out.push(answer(() => first === 'validate' ? v.validate(d) : v.isValidObject(d)))
    out.push(answer(() => v.isValidObject(d)), answer(() => v.validate(d)))
  }
  return out
}

;(async () => {
  const at = (f) => pathToFileURL(path.join(__dirname, '..', f)).href
  const Browser = (await import(at('index.v2.browser.mjs'))).Validator
  const Edge = (await import(at('index.v2.edge.mjs'))).Validator
  assert.notStrictEqual(Browser, Edge, 'the edge entry has a class of its own')
  assert.strictEqual(new Browser({}).core, undefined, 'loading the edge entry leaves the browser entry on the small engine')

  let n = 0
  for (const [label, schema, mutate, docs] of cases) {
    for (const first of ['isValidObject', 'validate']) {
      const got = run(Edge, schema, () => {}, docs, first)
      assert.deepStrictEqual(got, run(Browser, schema, () => {}, docs, first), `${label}, ${first} first: as the browser entry`)
      assert.deepStrictEqual(got, run(OneX, schema, () => {}, docs, first), `${label}, ${first} first: as the 1.x Validator`)
      for (const x of got.slice(1)) assert.strictEqual(x[0], x[1], `${label}, ${first} first: validate and isValidObject agree`)
      // Unsupported input: the schema changed after the first call.
      for (const x of run(Edge, schema, mutate, docs, first).slice(1)) for (const y of x) assert.strictEqual(typeof y, 'boolean', `${label}, ${first} first, changed: answered`)
      n++
    }
  }
  for (const [label, schema] of patterns) {
    for (const first of ['isValidObject', 'validate']) {
      const want = patternRun(Browser, schema, first)
      assert.deepStrictEqual(patternRun(Edge, schema, first), want, `${label}, ${first} first`)
      n++
    }
  }
  assert.ok(patternRun(Edge, patterns[0][1], 'validate').every((x) => typeof x === 'boolean'), 'an unreached bad pattern is not thrown')
  assert.ok(patternRun(Edge, patterns[1][1], 'validate').every((x) => x === 'throws SyntaxError'), 'a reached bad pattern is thrown as a SyntaxError')
  console.log(`test_validator_small_lifecycle: ok, ${n} cases answered by the edge entry as by the browser entry (and, unchanged, the 1.x Validator)`)
})().catch((e) => { console.error(e); process.exit(1) })
