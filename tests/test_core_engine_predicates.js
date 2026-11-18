'use strict'

// One predicate per leaf keyword (4b review, condition 2). The verdict form
// of lib/core/engine.js must check a leaf keyword by calling the predicate
// the walker calls (the engine's table PR), never by a check of its own.
//
// How: a test build of the engine exports PR. For each leaf keyword, its
// predicate is replaced by one that counts its calls and fails every value,
// and a schema whose form checks that keyword is built: once on the object
// itself, once on a declared property, once on a property of a nested form.
// The form, called directly, must reject a value the real predicate passes,
// and the counter must show the form called it. A form that carried its own
// copy of the check would accept the value, and the test fails. Every key of
// PR must be covered, so a leaf keyword added later fails here until it is.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '../lib/core/engine.js'), 'utf8')
assert.ok(src.includes('\nconst TEST = false\n'), 'engine.js has its TEST constant')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-core-engine-'))
const file = path.join(dir, 'engine-test.js')
fs.writeFileSync(file, src.replace('\nconst TEST = false\n', '\nconst TEST = { faults: 0, generic: 0 }\n').replace(/require\('\.\.\//g, `require(${JSON.stringify(path.join(__dirname, '../lib') + '/')} + '`))
const E = require(file)
fs.rmSync(dir, { recursive: true, force: true })
const PR = E._t.PR

// For each leaf keyword: its schema value and a value the real predicate passes.
const CASES = {
  type: ['string', 'x'],
  enum: [['x'], 'x'],
  const: ['x', 'x'],
  minimum: [0, 1],
  maximum: [5, 1],
  exclusiveMinimum: [0, 1],
  exclusiveMaximum: [5, 1],
  multipleOf: [1, 2],
  minLength: [0, 'x'],
  maxLength: [5, 'x'],
  pattern: ['^x$', 'x'],
  format: ['date', '2020-01-01'],
  minItems: [0, [1]],
  maxItems: [5, [1]],
  minProperties: [0, {}],
  maxProperties: [5, {}],
}
assert.deepStrictEqual(Object.keys(PR).sort(), Object.keys(CASES).sort(), 'every leaf predicate has a case here')

let checked = 0
for (const kw of Object.keys(CASES)) {
  const [x, good] = CASES[kw]
  const real = PR[kw]
  const onObject = kw === 'type' ? [{ type: 'string', properties: { a: {} } }, 'x'] : kw === 'minProperties' || kw === 'maxProperties' ? [{ type: 'object', [kw]: x, properties: { a: {} } }, { a: 1 }] : null
  const shapes = [
    ['a declared property', { type: 'object', properties: { a: { [kw]: x } } }, { a: good }],
    ['a property of a nested form', { type: 'object', properties: { o: { type: 'object', properties: { a: { [kw]: x } }, additionalProperties: false } } }, { o: { a: good } }],
  ]
  if (onObject) shapes.unshift(['the object itself', ...onObject])
  for (const [where, s, doc0] of shapes) {
    // The real predicate passes it.
    const e0 = E.createEngine(s, {})
    assert.ok(e0.r.v !== undefined, `${kw} on ${where}: a form is made`)
    assert.strictEqual(e0.r.v(structuredClone(doc0)), true, `${kw} on ${where}: the form passes the value`)
    // The poisoned predicate fails it, through the form, and is called.
    let calls = 0
    PR[kw] = () => { calls++; return false }
    try {
      const e = E.createEngine(s, {})
      assert.ok(e.r.v !== undefined, `${kw} on ${where}: a form is made`)
      assert.strictEqual(e.r.v(structuredClone(doc0)), false, `${kw} on ${where}: the form does not call the shared predicate`)
      assert.ok(calls > 0, `${kw} on ${where}: the shared predicate was not called`)
      const n = calls
      assert.strictEqual(e.validate(structuredClone(doc0)).valid, false, `${kw} on ${where}: the walker does not call the shared predicate`)
      assert.ok(calls > n, `${kw} on ${where}: the walker did not call the shared predicate`)
    } finally { PR[kw] = real }
    checked++
  }
}
assert.ok(checked >= 34, `${checked} cases`)
console.log(`test_core_engine_predicates: ok, ${Object.keys(PR).length} leaf predicates, ${checked} form cases, each through the shared predicate`)
