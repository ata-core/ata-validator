'use strict'

// The two engines have to report the same errors, not just the same verdict.
//
// tests/test_engine_differential.js compares verdicts and catches an engine
// that accepts what the other rejects. It says nothing about what comes back
// when both reject, and that is a second surface with its own history: a
// property key containing `/` produced "/a/b" from the generated code and
// "/a~1b" from the interpreter, `additionalProperties: false` reported
// keyword "additionalProperties" on one engine and "not" on the other, and
// propertyNames put its subschema errors at the failing key on one and at the
// object carrying it on the other. None of those change a verdict, so nothing
// went red, and the suite does not compare error text either.
//
// What makes this worth pinning rather than merely comparing: tests/
// test_ajv_parity.js already holds the compat entry's errors to the reference
// implementation, but only where code generation is allowed, because the
// reference cannot compile without it. So the reference cannot be consulted
// under a strict CSP at all. Holding the interpreter to the generated code
// here closes that by transitivity: codegen matches the reference, the
// interpreter matches codegen.
//
// Both engines cannot be reached from one process, since whether `new
// Function` works is a property of the realm. So this runs itself twice and
// diffs the two streams, the same way the verdict differential does.

const { spawnSync } = require('node:child_process')

// Schemas chosen for what they emit, not for whether they pass: every error
// keyword the object and array paths can raise, plus keys carrying the two
// characters JSON Pointer has to escape.
const SCHEMAS = [
  { type: 'object', properties: { 'a/b': { type: 'number' }, 'c~d': { type: 'number' }, plain: { type: 'number' } } },
  { type: 'object', properties: { 'a/b': { type: 'number' } }, required: ['a/b', 'm~n'] },
  { type: 'object', patternProperties: { '^x': { type: 'number' } } },
  { type: 'object', properties: {}, additionalProperties: { type: 'number' } },
  { type: 'object', additionalProperties: false, properties: { ok: { type: 'number' } } },
  { type: 'object', properties: { 'o/p': { type: 'object', properties: { 'q~r': { type: 'number' } } } } },
  { type: 'object', properties: { 'arr/x': { type: 'array', items: { type: 'number' } } } },
  { type: 'array', items: { type: 'object', properties: { 'k/1': { type: 'number' } } } },
  { type: 'object', propertyNames: { pattern: '^[a-z]+$', maxLength: 3 } },
  { type: 'object', propertyNames: false },
  { type: 'object', dependentSchemas: { 'a/b': { required: ['z~z'] } } },
  { type: 'object', dependentRequired: { 'a/b': ['z~z'] } },
  { type: 'object', properties: { 'a/b': { type: 'number' } }, unevaluatedProperties: false },
  { type: 'object', minProperties: 3, maxProperties: 1 },
  { type: 'array', prefixItems: [{ type: 'integer' }, { type: 'string' }], items: false },
  { type: 'array', minItems: 3, maxItems: 1, uniqueItems: true },
  { type: 'array', contains: { type: 'number' }, minContains: 2, maxContains: 1 },
  { type: 'string', minLength: 3, maxLength: 1, pattern: '^[a-z]+$' },
  { type: 'string', format: 'date-time' },
  { type: 'number', minimum: 5, maximum: 1, multipleOf: 3 },
  { type: 'number', exclusiveMinimum: 5, exclusiveMaximum: 1 },
  { enum: ['a', 'b'] },
  { const: { x: 1 } },
  { not: { type: 'string' } },
  { anyOf: [{ type: 'string' }, { type: 'number', minimum: 5 }] },
  { oneOf: [{ type: 'number', maximum: 5 }, { type: 'number', minimum: 3 }] },
  { allOf: [{ type: 'number' }, { minimum: 2 }] },
  { if: { type: 'number' }, then: { minimum: 10 }, else: { type: 'string' } },
  { $defs: { n: { type: 'integer' } }, $ref: '#/$defs/n' },
  { type: 'object', properties: { k: { type: 'array', items: { $ref: '#' } } } },
  { type: ['string', 'null'] },
  { type: 'object', required: ['a'], properties: { a: { type: 'object', required: ['b'], properties: { b: { type: 'number' } } } } },
]

const DOCS = [
  { 'a/b': 'x', 'c~d': 'y', plain: 'z' },
  { 'a/b': 1 },
  { 'x/1': 'no', 'x~2': 'no', y: 1 },
  { 'a/b': 'no', 'c~d': 'no' },
  { ok: 1, 'extra/key': 2, 'tilde~key': 3 },
  { 'o/p': { 'q~r': 'bad' } },
  { 'arr/x': [1, 'bad', 3] },
  [{ 'k/1': 'bad' }],
  { 'Ok/Bad': 1, toolong: 2 },
  { n: 1 },
  'plain string',
  42,
  3.5,
  null,
  true,
  [],
  [1, 'a', 2],
  [1, 1],
  {},
  { a: {} },
  { k: [{ k: ['x'] }] },
  '2026-13-45T99:99:99Z',
]

// abortEarly changes how many errors come back; removeAdditional and
// coerceTypes change the document before the checks see it. Each is a place
// the two engines have gone their own way before.
const OPTIONS = [
  {},
  { abortEarly: true },
  { coerceTypes: true },
  { removeAdditional: true },
]

function signature (errors) {
  return errors.map((e) => {
    const params = e.params && Object.keys(e.params).length
      ? JSON.stringify(e.params, Object.keys(e.params).sort())
      : ''
    return `${e.keyword}@${e.instancePath}#${e.schemaPath}${params ? '?' + params : ''}`
  }).join(' ')
}

function emit () {
  const { Validator } = require('..')
  const out = []
  for (let s = 0; s < SCHEMAS.length; s++) {
    for (let o = 0; o < OPTIONS.length; o++) {
      for (let d = 0; d < DOCS.length; d++) {
        let sig
        try {
          const schema = JSON.parse(JSON.stringify(SCHEMAS[s]))
          const doc = DOCS[d] === null || typeof DOCS[d] !== 'object'
            ? DOCS[d]
            : JSON.parse(JSON.stringify(DOCS[d]))
          const r = new Validator(schema, OPTIONS[o]).validate(doc)
          sig = r.valid ? 'valid' : signature(r.errors)
        } catch (e) {
          sig = 'threw:' + (e && e.constructor ? e.constructor.name : 'Error')
        }
        out.push(`${s}|${o}|${d}|${sig}`)
      }
    }
  }
  process.stdout.write(out.join('\n'))
}

// Written without process.exit(): the payload is large enough that exiting
// here truncates a pipe that has not drained, which shows up as the two runs
// reporting different case counts rather than as an error.
if (process.argv.includes('--emit')) {
  emit()
} else {

function run (blockCodegen) {
  const args = blockCodegen ? ['--disallow-code-generation-from-strings'] : []
  const r = spawnSync(process.execPath, [...args, __filename, '--emit'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ATA_NO_NATIVE: '1' },
  })
  if (r.status !== 0) {
    console.error('FAIL: the ' + (blockCodegen ? 'interpreted' : 'compiled') + ' run exited ' + r.status)
    console.error(r.stderr.split('\n').slice(0, 8).join('\n'))
    process.exit(1)
  }
  return r.stdout.split('\n')
}

const compiled = run(false)
const interpreted = run(true)

if (compiled.length !== interpreted.length) {
  console.error(`FAIL: the two runs reported ${compiled.length} and ${interpreted.length} cases`)
  process.exit(1)
}

const splits = []
for (let i = 0; i < compiled.length; i++) {
  if (compiled[i] === interpreted[i]) continue
  const [s, o, d] = compiled[i].split('|')
  const a = compiled[i].split('|').slice(3).join('|')
  const b = interpreted[i].split('|').slice(3).join('|')
  splits.push({ schema: SCHEMAS[+s], options: OPTIONS[+o], doc: DOCS[+d], compiled: a, interpreted: b })
}

if (splits.length) {
  console.error(`FAIL error shape differential: ${splits.length} of ${compiled.length} cases report different errors\n`)
  for (const x of splits.slice(0, 10)) {
    console.error('  schema      ' + JSON.stringify(x.schema))
    console.error('  options     ' + JSON.stringify(x.options))
    console.error('  document    ' + JSON.stringify(x.doc))
    console.error('  compiled    ' + x.compiled)
    console.error('  interpreted ' + x.interpreted)
    console.error('')
  }
  if (splits.length > 10) console.error(`  and ${splits.length - 10} more`)
  process.exit(1)
}

console.log(`error shape differential: ${compiled.length} cases, both engines report the same errors`)
}
