'use strict'

// The text scanner behind validateJSON and isValidJSON is generated per
// schema. It used to be one function with every `$ref` expanded where it was
// used, so a schema reaching the same definitions from many places made it
// hundreds of kilobytes, and V8's Maglev tier aborted the whole process
// compiling it after about a hundred calls: traefik and detekt from
// SchemaStore, in plain JavaScript, on Node 24 and 25. A large reference
// target is now one function, called at each reference, and a large object
// member is moved into one, so no function grows with the schema. This builds
// schemas of both shapes and checks that they get a scanner, that no function
// in it passes the cap, and that it answers as validate() does, duplicate keys
// included: a member scanned by a function of its own still lets a later
// duplicate replace an invalid earlier value, as JSON.parse does.

const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { compileScanner } = require('../lib/scan-compiler')
const { Validator } = require('..')

const CAP = 64 * 1024

// Many references to two definitions, one referencing the other.
function refs (n) {
  const leaf = { type: 'object', properties: {}, additionalProperties: false }
  for (let j = 0; j < 6; j++) leaf.properties['f' + j] = { type: j % 2 ? 'string' : 'integer' }
  const mid = { type: 'object', properties: {} }
  for (let j = 0; j < 6; j++) mid.properties['m' + j] = { $ref: '#/definitions/leaf' }
  const props = {}
  for (let i = 0; i < n; i++) props['p' + i] = { $ref: '#/definitions/mid' }
  return { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', definitions: { leaf, mid }, properties: props }
}
// Large objects written out inline, no references.
function inline (n) {
  const props = {}
  for (let i = 0; i < n; i++) {
    const rule = {}
    for (let j = 0; j < 30; j++) rule['r' + j] = { type: 'object', properties: { active: { type: 'boolean' }, level: { enum: ['low', 'mid', 'high'] }, limit: { type: 'integer', minimum: 0 } }, additionalProperties: false }
    props['set' + i] = { type: 'object', properties: rule, additionalProperties: false }
  }
  return { type: 'object', properties: props }
}

let scanners = 0, compared = 0
for (const [label, schema, docs] of [
  ['references', refs(40), [
    { p0: { m0: { f0: 1, f1: 'a' } } },
    { p0: { m0: { f0: 'x' } } },
    { p3: { m5: { f9: 1 } } },
    '{"p0":{"m0":{"f0":"x"}},"p0":{"m0":{"f0":1}}}',
    '{"p0":{"m0":{"f0":1}},"p0":{"m0":{"f0":"x"}}}',
  ]],
  ['inline objects', inline(8), [
    { set0: { r0: { active: true, level: 'low', limit: 3 } } },
    { set0: { r0: { active: 'yes' } } },
    { set7: { r29: { level: 'max' } } },
    '{"set1":{"r1":{"limit":-1}},"set1":{"r1":{"limit":1}}}',
    '{"set1":{"r1":{"limit":1}},"set1":{"r1":{"limit":-1}}}',
  ]],
]) {
  const v = new Validator(schema)
  const built = compileScanner(v._schemaObj)
  assert.ok(built, `${label}: the schema should get a scanner`)
  scanners++
  for (const src of built.functions) assert.ok(src.length <= CAP, `${label}: a scanner function of ${src.length} characters passes the cap`)
  assert.ok(built.functions.length > 1, `${label}: expected the scan split into functions`)
  for (const d of docs) {
    const text = typeof d === 'string' ? d : JSON.stringify(d)
    const want = v.validate(JSON.parse(text)).valid
    for (let r = 0; r < 120; r++) {
      assert.strictEqual(v.isValidJSON(text), want, `${label}: isValidJSON on ${text}`)
      assert.strictEqual(v.validateJSON(text).valid, want, `${label}: validateJSON on ${text}`)
    }
    compared++
  }
}

// The shapes again in a child process, past the call count at which the
// process used to abort.
const child = `
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))})
const v = new Validator((${refs.toString()})(40))
const ok = JSON.stringify({ p0: { m0: { f0: 1, f1: 'a' } } })
let n = 0
for (let i = 0; i < 400; i++) { if (v.validateJSON(ok).valid) n++; if (v.isValidJSON(ok)) n++ }
process.stdout.write(String(n))
`
const r = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
assert.strictEqual(r.status, 0, `the process exited with ${r.status} ${r.signal || ''}: ${(r.stderr || '').split('\n').slice(-3).join(' ')}`)
assert.strictEqual(r.stdout, '800')
console.log(`ok: large schemas get a scanner split into bounded functions that answers as validate() does (${scanners} schemas, ${compared} documents, duplicate keys included)`)
