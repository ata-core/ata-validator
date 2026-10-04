'use strict'

// The text scanner behind validateJSON and isValidJSON is one generated
// function per schema. A schema that reaches the same definitions through many
// references made that function hundreds of kilobytes, since each reference
// is expanded where it is used, and V8's Maglev tier aborted the whole process
// compiling it after about a hundred calls: traefik and detekt from
// SchemaStore, in plain JavaScript, on Node 24 and 25. compileScanner now
// declines past a size, and the text path parses instead. This builds a
// schema of that shape and checks the scanner declines it for its size. The
// abort itself depends on more than size: this schema's 858 KB scanner did
// not trigger it, so it is not reproduced here; the SchemaStore schemas that
// did run clean in the child-process sweep this fix was checked with. The
// child process below validates against the schema past the call count at
// which those aborted, as a check that the declined path answers.

const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { compileScanner } = require('../lib/scan-compiler')

function synth (n) {
  const leaf = { type: 'object', properties: {}, additionalProperties: false }
  for (let j = 0; j < 6; j++) leaf.properties['f' + j] = { type: j % 2 ? 'string' : 'integer' }
  const mid = { type: 'object', properties: {} }
  for (let j = 0; j < 6; j++) mid.properties['m' + j] = { $ref: '#/definitions/leaf' }
  const props = {}
  for (let i = 0; i < n; i++) props['p' + i] = { $ref: '#/definitions/mid' }
  return { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', definitions: { leaf, mid }, properties: props }
}

let reason = null
const scanner = compileScanner(synth(20), { onDecline: (r) => { reason = r } })
assert.strictEqual(scanner, null, 'a scanner this size should be declined')
assert.strictEqual(reason, 'size')
// A small one still gets a scanner.
assert.ok(compileScanner(synth(1)), 'a small schema keeps its scanner')

const child = `
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))})
const schema = (${synth.toString()})(20)
const v = new Validator(schema, { richErrors: false })
const ok = JSON.stringify({ p0: { m0: { f0: 1, f1: 'a' } } })
const bad = JSON.stringify({ p0: { m0: { f0: 'x' } }, p1: { m2: { f9: 1 } } })
let n = 0
for (let i = 0; i < 300; i++) { if (v.validateJSON(ok).valid) n++; if (!v.validateJSON(bad).valid) n++; if (v.isValidJSON(ok)) n++ }
process.stdout.write(String(n))
`
const r = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
assert.strictEqual(r.status, 0, `the process exited with ${r.status} ${r.signal || ''}: ${(r.stderr || '').split('\n').slice(-3).join(' ')}`)
assert.strictEqual(r.stdout, '900', 'every answer as expected')
console.log('ok: an oversized scanner is declined, and validating against its schema past the old abort point is fine')
