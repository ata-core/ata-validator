'use strict'

// Data that points back at itself used to exhaust the stack on the compiled
// path while the interpreted engine settled on an answer, so the two engines
// disagreed on input JSON cannot express but an in-memory object graph can:
// a form model, an ORM entity, anything with a parent pointer.
//
// The rule both engines follow: a value already being checked against a schema
// is a fixed point and counts as satisfied. These tests pin that, and pin that
// a cycle does not hide a real violation elsewhere in the document.

const assert = require('assert')
const { execFileSync } = require('child_process')
const path = require('path')

let pass = 0
function ok (name, fn) {
  fn()
  pass++
  console.log('  PASS ', name)
}

const { Validator } = require('../index.js')

const selfRef = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    subs: { type: 'array', items: { $ref: '#' } },
  },
}

const viaDefs = {
  $defs: {
    node: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, next: { $ref: '#/$defs/node' } },
    },
  },
  $ref: '#/$defs/node',
}

ok('a self-referencing document is satisfied, not a stack overflow', () => {
  const v = new Validator(selfRef)
  const doc = { name: 'root', subs: [] }
  doc.subs.push(doc)
  const r = v.validate(doc)
  assert.strictEqual(r.valid, true)
  assert.strictEqual(r.errors.length, 0)
  assert.strictEqual(v.isValidObject(doc), true)
  assert.strictEqual(v.engine(), 'codegen')
})

ok('a cycle does not hide a violation elsewhere', () => {
  const v = new Validator(selfRef)
  const a = { name: 'root', subs: [] }
  const b = { name: 42, subs: [] }
  a.subs.push(b)
  b.subs.push(a)
  const r = v.validate(a)
  assert.strictEqual(r.valid, false)
  assert.strictEqual(r.errors[0].path, '/subs/0/name')
  assert.strictEqual(v.isValidObject(a), false)
})

ok('a cycle through $defs settles the same way', () => {
  const v = new Validator(viaDefs)
  const node = { name: 'a' }
  node.next = node
  assert.strictEqual(v.validate(node).valid, true)
  assert.strictEqual(v.isValidObject(node), true)
})

ok('the same object in two sibling positions is not a cycle', () => {
  const v = new Validator(selfRef)
  const leaf = { name: 'leaf', subs: [] }
  assert.strictEqual(v.validate({ name: 'root', subs: [leaf, leaf] }).valid, true)
  const bad = { name: 7, subs: [] }
  assert.strictEqual(v.validate({ name: 'root', subs: [bad, bad] }).valid, false)
})

ok('deep documents without a cycle still validate normally', () => {
  const v = new Validator(selfRef)
  let deep = { name: 'leaf', subs: [] }
  for (let i = 0; i < 400; i++) deep = { name: 'n' + i, subs: [deep] }
  assert.strictEqual(v.validate(deep).valid, true)

  // Past the depth the fast pass gives up at, so this document is answered by
  // the guarded pass even though nothing in it is cyclic.
  let deeper = { name: 'leaf', subs: [] }
  for (let i = 0; i < 900; i++) deeper = { name: 'n' + i, subs: [deeper] }
  assert.strictEqual(v.validate(deeper).valid, true)

  let deeperBad = { name: 7, subs: [] }
  for (let i = 0; i < 900; i++) deeperBad = { name: 'n' + i, subs: [deeperBad] }
  assert.strictEqual(v.validate(deeperBad).valid, false)
})

ok('a validator reused after a cyclic document keeps working', () => {
  const v = new Validator(selfRef)
  const doc = { name: 'root', subs: [] }
  doc.subs.push(doc)
  v.validate(doc)
  assert.strictEqual(v.validate({ name: 'plain', subs: [] }).valid, true)
  assert.strictEqual(v.validate({ name: 9, subs: [] }).valid, false)
  assert.strictEqual(v.validate(doc).valid, true)
})

// Runs the same two documents in a child process so the engine under test can
// be chosen by environment, and reports what came back.
function childRun (env, blockCodegen) {
  const script = `
    ${blockCodegen ? BLOCK_CODEGEN : ''}
    const { Validator } = require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))})
    const v = new Validator(${JSON.stringify(selfRef)})
    const a = { name: 'root', subs: [] }
    a.subs.push(a)
    const good = v.validate(a)
    const x = { name: 'root', subs: [] }
    const y = { name: 42, subs: [] }
    x.subs.push(y); y.subs.push(x)
    const bad = v.validate(x)
    console.log(JSON.stringify({
      engine: v.engine(),
      good: good.valid,
      bad: bad.valid,
      badPath: bad.errors[0] && bad.errors[0].path,
      badKeyword: bad.errors[0] && bad.errors[0].keyword,
    }))
  `
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, env),
  })
  return JSON.parse(out.trim().split('\n').pop())
}

const BLOCK_CODEGEN = `
    const Real = Function
    globalThis.eval = () => { throw new EvalError('blocked') }
    const Guarded = new Proxy(Real, {
      construct () { throw new EvalError('blocked') },
      apply (t, a, args) { if (args.length) throw new EvalError('blocked'); return Reflect.apply(t, a, args) },
    })
    Object.defineProperty(globalThis, 'Function', { value: Guarded, writable: true, configurable: true })
`

ok('the compiled engine settles a cycle and reports the real error', () => {
  const got = childRun({ ATA_NO_NATIVE: '1' }, false)
  assert.strictEqual(got.engine, 'codegen')
  assert.strictEqual(got.good, true)
  assert.strictEqual(got.bad, false)
  assert.strictEqual(got.badPath, '/subs/0/name')
  assert.strictEqual(got.badKeyword, 'type')
})

ok('the interpreted engine answers the same, with code generation blocked', () => {
  const got = childRun({ ATA_NO_NATIVE: '1' }, true)
  assert.strictEqual(got.engine, 'interpreter')
  assert.strictEqual(got.good, true)
  assert.strictEqual(got.bad, false)
  assert.strictEqual(got.badPath, '/subs/0/name')
  assert.strictEqual(got.badKeyword, 'type')
})

console.log(`${pass}/8 cyclic-input tests passed.`)
