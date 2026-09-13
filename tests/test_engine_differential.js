'use strict'

// The compiled engine and the interpreted one must answer the same question
// the same way. The official suite does not hold them to that: both paths
// already pass it whole, so a document the suite never asks about can split
// them without anything going red.
//
// Every engine disagreement found so far lived in exactly that blind spot.
// A value JSON cannot carry (NaN reached the tier-0 verdict but not the
// walker). An option rather than a keyword (removeAdditional stripped the root
// object on one path and every level on the other). A keyword one engine
// implemented and the other ignored (json-pointer, uri-template, regex,
// relative-json-pointer). An older dialect's spelling (a boolean
// exclusiveMaximum became 1 in generated code and was dropped in the
// interpreter). None of those are suite cases, and each was found by hand
// while doing something else.
//
// So this walks that blind spot on purpose: JavaScript values that are not
// JSON, the options, the older spellings, the formats, crossed with each
// other. The corpus is generated from one seed, so a failure names a case that
// reproduces.
//
// Both engines cannot be reached from one process: whether `new Function`
// works is a property of the realm, probed once. So the driver runs itself
// twice, once with code generation blocked, and compares the two streams. That
// is also what a user sees, normalization and option handling included, rather
// than what an internal entry point would report.

const { spawnSync } = require('node:child_process')
const path = require('node:path')

// ---------------------------------------------------------------------------
// corpus

const SCHEMAS = [
  // numbers, where the non-JSON values live
  { type: 'number' },
  { type: 'integer' },
  { type: 'number', minimum: 0, maximum: 10 },
  { type: 'number', exclusiveMinimum: 0 },
  { type: 'number', multipleOf: 0.1 },
  // the draft-04 spelling of the same bounds
  { $schema: 'http://json-schema.org/draft-04/schema#', minimum: 3, exclusiveMinimum: true },
  { $schema: 'http://json-schema.org/draft-04/schema#', maximum: 5, exclusiveMaximum: true },
  { $schema: 'http://json-schema.org/draft-04/schema#', maximum: 5, exclusiveMaximum: false },
  // strings and the formats each engine has to agree about
  { type: 'string', minLength: 1, maxLength: 5 },
  { type: 'string', pattern: '^[a-z]+$' },
  ...['email', 'date', 'date-time', 'time', 'duration', 'uri', 'uri-reference',
    'uri-template', 'iri', 'iri-reference', 'idn-email', 'hostname', 'ipv4',
    'ipv6', 'uuid', 'json-pointer', 'relative-json-pointer', 'regex',
  ].map((format) => ({ type: 'string', format })),
  // objects, where the options act
  { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
  { type: 'object', additionalProperties: false, properties: { a: { type: 'number' } } },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      a: { type: 'number' },
      nested: {
        type: 'object',
        additionalProperties: false,
        properties: { x: { type: 'number' } },
      },
    },
  },
  { type: 'object', properties: { a: { type: 'string', default: 'filled' } }, required: ['a'] },
  { type: 'object', properties: { n: { type: 'integer' } } },
  { type: 'object', minProperties: 1, maxProperties: 2 },
  { type: 'object', propertyNames: { pattern: '^[a-z]+$' } },
  { type: 'object', patternProperties: { '^x-': { type: 'number' } } },
  // arrays
  { type: 'array', items: { type: 'number' } },
  { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true },
  { type: 'array', prefixItems: [{ type: 'integer' }, { type: 'string' }] },
  { type: 'array', contains: { type: 'number' }, minContains: 2 },
  // the older spellings of the same shapes
  { $schema: 'http://json-schema.org/draft-07/schema#', items: [{ type: 'integer' }, { type: 'string' }] },
  { $schema: 'http://json-schema.org/draft-07/schema#', dependencies: { a: ['b'] } },
  { $schema: 'http://json-schema.org/draft-07/schema#', definitions: { n: { type: 'integer' } }, $ref: '#/definitions/n' },
  // composition, which routes schemas between engines
  { anyOf: [{ type: 'string' }, { type: 'number', minimum: 5 }] },
  { oneOf: [{ type: 'number', maximum: 5 }, { type: 'number', minimum: 3 }] },
  { allOf: [{ type: 'number' }, { minimum: 2 }] },
  { not: { type: 'string' } },
  { if: { type: 'number' }, then: { minimum: 10 }, else: { type: 'string' } },
  { $defs: { n: { type: 'integer' } }, $ref: '#/$defs/n' },
  { type: 'object', unevaluatedProperties: false, properties: { a: { type: 'number' } } },
  // enum and const, which compare structurally
  { enum: [1, 'a', null, { x: 1 }, [1, 2]] },
  { const: { x: 1, y: [2] } },
  // nullable, an option-shaped keyword of its own
  { type: 'string', nullable: true },
]

// Values JSON cannot carry sit first: they are where the engines drifted.
const VALUES = [
  NaN, Infinity, -Infinity, -0, 0, 1, 3, 4, 5, 5.5, 10, 11, -1,
  '', 'a', 'abc', 'ABC', 'a@b.co', '.a@b.co', '2020-02-30', '2020-02-29',
  '23:59:60Z', '12:00:00', 'P1Y2D', 'P4DT12H30M5S', '/a/b', '/a~', '{x}', 'a b',
  'http://x.co/a', 'http://x.co/a\\b', '::1', '1.2.3.4', 'not a uuid',
  true, false, null,
  [], [1], [1, 2], [1, 1], [1, 'a'], ['a', 1], [NaN],
  {}, { a: 1 }, { a: NaN }, { a: 'x' }, { a: 1, b: 2 },
  { a: 1, extra: 1 }, { a: 1, nested: { x: 1, extra: 2 } },
  { n: '5' }, { n: true }, { 'x-a': 1 }, { 'x-a': 'no' }, { UPPER: 1 },
  { x: 1, y: [2] },
]

// The options are where a keyword-only comparison stops looking.
const OPTIONS = [
  {},
  { useDefaults: false },
  { removeAdditional: true },
  { coerceTypes: true },
  { assertFormat: false },
  { removeAdditional: true, coerceTypes: true, useDefaults: false },
]

function* cases () {
  for (let s = 0; s < SCHEMAS.length; s++) {
    for (let o = 0; o < OPTIONS.length; o++) {
      for (let v = 0; v < VALUES.length; v++) yield { s, o, v }
    }
  }
}

// ---------------------------------------------------------------------------
// one run

function describe (value) {
  if (typeof value === 'number' && !isFinite(value)) return String(value)
  if (Object.is(value, -0)) return '-0'
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}

function emit () {
  const { Validator } = require('..')
  const out = []
  for (const { s, o, v } of cases()) {
    // Each case gets its own copies: the options mutate what they are given,
    // and a schema carried between cases would take a previous rewrite with it.
    const schema = JSON.parse(JSON.stringify(SCHEMAS[s]))
    const value = VALUES[v] === undefined ? undefined : structuredCloneSafe(VALUES[v])
    let verdict
    try {
      verdict = new Validator(schema, OPTIONS[o]).isValidObject(value) ? 1 : 0
    } catch (e) {
      verdict = 'threw:' + (e && e.constructor ? e.constructor.name : 'Error')
    }
    // validate() walks its own path and has disagreed with the verdict before.
    const schema2 = JSON.parse(JSON.stringify(SCHEMAS[s]))
    const value2 = VALUES[v] === undefined ? undefined : structuredCloneSafe(VALUES[v])
    let reported
    try {
      reported = new Validator(schema2, OPTIONS[o]).validate(value2).valid ? 1 : 0
    } catch (e) {
      reported = 'threw:' + (e && e.constructor ? e.constructor.name : 'Error')
    }
    out.push(`${s},${o},${v},${verdict},${reported}`)
  }
  process.stdout.write(out.join('\n'))
}

function structuredCloneSafe (v) {
  if (v === null || typeof v !== 'object') return v
  return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && !isFinite(x) ? '__nonfinite__' : x)),
    (k, x) => (x === '__nonfinite__' ? NaN : x))
}

// Written without process.exit(): the payload is large enough that exiting
// here truncates a pipe that has not drained, and the run then reports fewer
// cases than the other one. That is exactly how it failed in CI, where the
// machine is slower and the pipe drains later, while it always passed locally.
if (process.argv.includes('--emit')) {
  emit()
} else {

// ---------------------------------------------------------------------------
// driver

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

const disagreements = []
for (let i = 0; i < compiled.length; i++) {
  if (compiled[i] === interpreted[i]) continue
  const [s, o, v] = compiled[i].split(',')
  const [, , , cVerdict, cReported] = compiled[i].split(',')
  const [, , , iVerdict, iReported] = interpreted[i].split(',')
  disagreements.push({
    schema: SCHEMAS[+s],
    options: OPTIONS[+o],
    value: VALUES[+v],
    compiled: { isValidObject: cVerdict, validate: cReported },
    interpreted: { isValidObject: iVerdict, validate: iReported },
  })
}

if (disagreements.length) {
  console.error(`FAIL engine differential: ${disagreements.length} of ${compiled.length} cases split the engines\n`)
  for (const d of disagreements.slice(0, 12)) {
    console.error('  schema  ' + JSON.stringify(d.schema))
    console.error('  options ' + JSON.stringify(d.options))
    console.error('  value   ' + describe(d.value))
    console.error(`  compiled    isValidObject=${d.compiled.isValidObject} validate=${d.compiled.validate}`)
    console.error(`  interpreted isValidObject=${d.interpreted.isValidObject} validate=${d.interpreted.validate}`)
    console.error('')
  }
  if (disagreements.length > 12) console.error(`  and ${disagreements.length - 12} more`)
  process.exit(1)
}

console.log(`engine differential: ${compiled.length} cases, the compiled and interpreted engines agree on all of them`)
}
