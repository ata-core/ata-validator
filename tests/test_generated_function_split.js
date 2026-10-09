'use strict'

// Large property subschemas compile to functions of their own in all three
// generators. V8 does not optimize a function past its bytecode budget, and
// a configuration schema of a few hundred properties compiled to one function
// of a megabyte or more that ran in the interpreter for its whole life: on a
// 167 KB schema the verdict took 407 us where the same checks in functions of
// their own take 40. Held here: the generators split such a schema, no
// generated function is larger than a bound, every answer still agrees with
// the interpreted engine, and a small schema compiles without any split.

const assert = require('node:assert')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')
const { compileToJSCodegen } = require('../lib/js-compiler')
const errorsGen = require('../lib/js-compiler-errors')

let seed = 11
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
function makeSchema (sections) {
  const $defs = { port: { type: 'integer', minimum: 1, maximum: 65535 }, name: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,30}$' }, level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] } }
  const properties = {}; const required = []
  for (let s = 0; s < sections; s++) {
    const props = {}; const req = []; const n = 20 + rnd(21)
    for (let p = 0; p < n; p++) {
      const k = `key${p}`; const t = rnd(5)
      props[k] = t === 0 ? { $ref: '#/$defs/port' } : t === 1 ? { $ref: '#/$defs/name' } : t === 2 ? { $ref: '#/$defs/level' } : t === 3 ? { type: 'boolean' } : { type: 'integer', minimum: 0, maximum: 1000 }
      if (p % 3 === 0) req.push(k)
    }
    properties[`section${s}`] = { type: 'object', properties: props, required: req, additionalProperties: false }
    required.push(`section${s}`)
  }
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', $defs, properties, required, additionalProperties: false }
}
function makeDoc (schema, broken) {
  const doc = {}; let s = 0
  for (const [sk, sec] of Object.entries(schema.properties)) {
    const o = {}; const bad = broken && s % 7 === 3
    for (const [k, p] of Object.entries(sec.properties)) {
      const ref = p.$ref ? p.$ref.split('/').pop() : null
      let v = ref === 'port' ? 8080 : ref === 'name' ? 'svc-name' : ref === 'level' ? 'info' : p.type === 'boolean' ? true : 42
      if (bad && k.endsWith('1')) v = p.type === 'boolean' ? 'yes' : 12.5
      o[k] = v
    }
    if (bad) { o.unknownKey = 1 }
    doc[sk] = o; s++
  }
  return doc
}
// The largest function in a program's source by its own code, nested
// functions left out: a module wraps everything in one factory that runs
// once, and V8 optimizes each inner function on its own.
function largestFunction (src) {
  const spans = []
  const re = /function\s*[A-Za-z0-9_$]*\s*\([^)]*\)\s*\{/g
  let m
  while ((m = re.exec(src)) !== null) {
    let depth = 0
    for (let k = m.index + m[0].length - 1; k < src.length; k++) {
      const ch = src[k]
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { spans.push([m.index, k + 1]); break } }
    }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  let max = 0
  const stack = []
  const own = spans.map(([a, b]) => b - a)
  for (let i = 0; i < spans.length; i++) {
    while (stack.length && spans[stack[stack.length - 1]][1] <= spans[i][0]) stack.pop()
    if (stack.length) own[stack[stack.length - 1]] -= spans[i][1] - spans[i][0]
    stack.push(i)
  }
  for (const n of own) max = Math.max(max, n)
  return max
}

const BOUND = 200 * 1024

// The big schema: 60 sections, about 70 KB.
const schema = makeSchema(60)
const valid = makeDoc(schema, false), invalid = makeDoc(schema, true)
const interp = new Validator(schema, { engine: 'interpreter', richErrors: false })
const gen = new Validator(schema, { richErrors: false })
assert.strictEqual(gen.engine(), 'codegen')
const want = interp.validate(invalid).errors.map((e) => e.instancePath + ' ' + e.keyword)
assert.ok(want.length >= 10, 'the invalid document carries errors')
for (let r = 0; r < 80; r++) { gen.isValidObject(valid); void gen.validate(invalid).errors } // through the tiers
assert.strictEqual(gen.validate(valid).valid, true)
assert.deepStrictEqual(gen.validate(invalid).errors.map((e) => e.instancePath + ' ' + e.keyword), want, 'the generated engine reports what the interpreter does')

// The verdict program: split into `_pf` functions, none past the bound.
const boolFn = compileToJSCodegen(schema, null, null, { full: true })
assert.ok(boolFn && boolFn._source, 'the verdict compiled')
const verdictSrc = (boolFn._preambleSource || '') + '\n' + boolFn._source
assert.ok((verdictSrc.match(/function _pf\d+\(/g) || []).length >= 50, 'the verdict hoists the sections into functions')
assert.ok(largestFunction(verdictSrc) < BOUND, `the largest verdict function is ${largestFunction(verdictSrc)} bytes`)

// The one-pass program, as a standalone module emits it: `_pc` functions, and the error collector's `_pe`.
const mod = toStandaloneModule(new Validator(schema, { richErrors: false }), { format: 'cjs', positions: true, onePass: true })
assert.ok(mod, 'the module compiled')
assert.ok((mod.match(/function _pc\d+\(/g) || []).length >= 50, 'the one-pass function hoists the sections')
assert.ok(largestFunction(mod) < BOUND, `the largest function in the one-pass module is ${largestFunction(mod)} bytes`)
const modE = toStandaloneModule(new Validator(schema, { richErrors: false }), { format: 'cjs', positions: true })
assert.ok((modE.match(/function _pe\d+\(/g) || []).length >= 50, 'the error collector hoists the sections')
assert.ok(largestFunction(modE) < BOUND, `the largest function in the default module is ${largestFunction(modE)} bytes`)
for (const src of [mod, modE]) {
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, require)
  assert.strictEqual(m.exports.validate(valid).valid, true)
  // As a set: a module lists an object's additionalProperties error before
  // its properties' errors, the interpreter after; that order predates the
  // split and is not what this test is about.
  assert.deepStrictEqual(m.exports.validate(invalid).errors.map((e) => e.instancePath + ' ' + e.keyword).sort(), [...want].sort(), 'the module reports what the interpreter does')
  assert.strictEqual(m.exports.validateJSON(JSON.stringify(invalid)).errors.length, want.length)
}

// A small schema compiles without a split: every property stays inline.
const small = { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string', minLength: 1 }, age: { type: 'integer', minimum: 13 }, address: { type: 'object', properties: { city: { type: 'string' }, zip: { type: 'string', pattern: '^[0-9]{5}$' } } } } }
const smallFn = compileToJSCodegen(small, null, null, { full: true })
assert.ok(!/function _pf\d+\(/.test((smallFn._preambleSource || '') + smallFn._source), 'a small schema has no hoisted property functions')
const smallMod = toStandaloneModule(new Validator(small), { format: 'cjs', onePass: true })
assert.ok(!/function _p[ce]\d+\(/.test(smallMod), 'a small module has no hoisted property functions')

console.log(`ok: large property subschemas become functions of their own in the three generators; the largest function in the one-pass module is ${(largestFunction(mod) / 1024).toFixed(0)} KB, and a small schema stays inline`)
