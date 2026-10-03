'use strict'

// The text paths read numbers as they are written, the object path reads them
// after JSON.parse. `1.0` is an integer to JSON Schema and to validate(), since
// JSON.parse gives 1, but simdjson reports it as a double, and the native
// engine took the element type for the JSON Schema type: `{"id": 1.0}` against
// `type: "integer"` was valid through validate() and invalid through
// isValid(buffer) and through validateJSON once the document passed the native
// threshold, where the rejection then carried no real error. Integers past 64
// bits are simdjson's BIGINT, which the native type table did not map to any
// JSON type at all. tests/test_buffer_path_parity.js could not see either: the
// suite's documents are re-serialized from parsed values, so `1.0` comes back
// as `1`. This writes the number text directly.

const assert = require('node:assert')
const { Validator } = require('..')
const { getNative } = require('../lib/validator-core')._internals

const NUMBERS = [
  '1', '1.0', '1.00', '1e0', '1E2', '1.5e1', '100e-2', '-0', '-0.0', '0.0',
  '1.5', '-2.5', '1e-1', '3.0000000001',
  '9007199254740993', '9223372036854775807', '9223372036854775808', '-9223372036854775808', '-9223372036854775809',
  '18446744073709551615', '18446744073709551616', '100000000000000000000000000000', '-100000000000000000000000000000',
  '1e30', '1.0e30', '-1e30', '1e308',
]

const SCHEMAS = [
  { type: 'integer' }, { type: 'number' }, { type: ['integer', 'string'] }, { type: ['number', 'null'] },
  { type: 'integer', minimum: 0 }, { type: 'integer', maximum: 100 }, { type: 'number', exclusiveMinimum: 1 },
  { type: 'integer', multipleOf: 2 }, { multipleOf: 0.5 }, { minimum: 1e20 }, { maximum: -1e20 },
  { enum: [1, 2] }, { const: 1 }, { enum: [9223372036854775807] }, { not: { type: 'integer' } },
  { anyOf: [{ type: 'integer' }, { type: 'string' }] },
]

// Past 8192 bytes validateJSON answers from the native engine first.
const PAD = 'x'.repeat(9000)

// One known gap, in simdjson rather than here: a 20-digit integer at or past
// 2^64 is reported as an invalid number instead of a big integer
// (numberparsing.h, the positive 20-digit overflow check returns INVALID_NUMBER
// where the longer case returns BIGINT_NUMBER), so number_as_string never sees
// it and the document fails to parse. 21 digits and more parse as BIGINT, and
// the on-demand path reads it, so only documents that reach the DOM parser are
// affected. It is held to exactly that literal class here; any other
// difference fails.
const SIMDJSON_20_DIGIT = (lit) => /^\d{20}$/.test(lit) && BigInt(lit) >= 2n ** 64n

const native = getNative()
let compared = 0
let known = 0
const diffs = []
for (const s of SCHEMAS) {
  const v = new Validator({ type: 'object', properties: { n: s, pad: { type: 'string' } }, required: ['n'] })
  for (const lit of NUMBERS) {
    const small = `{"n":${lit}}`
    const large = `{"n":${lit},"pad":"${PAD}"}`
    const want = v.validate(JSON.parse(small)).valid
    const got = {
      'isValid(buffer)': v.isValid(Buffer.from(small)),
      'isValid(large buffer)': v.isValid(Buffer.from(large)),
      'validateJSON(large)': v.validateJSON(large).valid,
      'isValidJSON(large)': v.isValidJSON(large),
      'countValid': v.countValid(Buffer.from(small + '\n' + small)) === (want ? 2 : 0),
    }
    for (const [path, answer] of Object.entries(got)) {
      compared++
      const ok = path === 'countValid' ? answer : answer === want
      if (!ok && native && SIMDJSON_20_DIGIT(lit)) { known++; continue }
      if (!ok) diffs.push(`${path} ${JSON.stringify(s)} on ${lit}: validate() says ${want}`)
    }
    // A rejection must name a real error, not the stub that says only that
    // validation failed.
    const r = v.validateJSON(large)
    if (!r.valid && !(native && SIMDJSON_20_DIGIT(lit))) {
      compared++
      if (r.errors.some((e) => e.code === 'ATA9001')) diffs.push(`validateJSON(large) ${JSON.stringify(s)} on ${lit}: rejected with no real error`)
    }
  }
}

if (diffs.length) {
  console.log(diffs.slice(0, 20).join('\n'))
  assert.fail(`${diffs.length} answers differ from validate() on number text (${native ? 'native engine loaded' : 'no native engine'})`)
}
assert.ok(compared >= 2000, `too few comparisons: ${compared}`)
console.log(`ok: number text answers as validate() on every text path (${compared} checks, ${native ? `native engine loaded, ${known} on the known simdjson 20-digit gap` : 'pure JS'})`)
