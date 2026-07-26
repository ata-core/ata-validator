'use strict'

// Format assertions live in two hand-maintained places: the JS codegen
// emitters in lib/js-compiler.js and the predicate functions in
// lib/interpreter.js. A schema can land on either engine depending on its
// shape and the runtime, so the two copies MUST agree on every format for
// every input. They have drifted before (date-time case, duration trailing
// "T", uri-reference empty string, and the weak uri scheme-only check that a
// third-party benchmark caught). This test pins them together: it runs a
// format corpus through both engines and fails on any disagreement.

const assert = require('assert')
const { compileToJSCodegen } = require('../lib/js-compiler.js')
const { createInterpreter } = require('../lib/interpreter.js')

const FORMATS = [
  'email', 'date', 'date-time', 'time', 'duration', 'uuid',
  'uri', 'uri-reference', 'ipv4', 'ipv6', 'hostname',
]

// Mix of valid values, boundary values, and near-misses that have historically
// exposed drift. Includes control-char and whitespace probes for the uri family.
const CORPUS = [
  '', ' ', '  ', 'abc', 'a\tb',
  'https://ok.com', 'https://a-b.com/x?y=1#z', 'mailto:x@y.com', 'urn:isbn:1',
  'https: not a url', 'http://a b.com', 'nope', '//host/path', '/rel/path',
  'a@b.com', 'a@b', '@b.com', 'a@',
  '2020-01-02', '2020-13-40', '2020-00-00', '0000-01-01',
  '2020-01-02T03:04:05Z', '2020-01-02t03:04:05z', '2020-01-02 03:04:05Z',
  '2020-01-02T03:04:05.678+01:00', '2020-01-02T99:99:99Z',
  '03:04:05', '25:00:00', '03:04:05.5Z',
  'P1Y', 'P1Y2M3DT4H5M6S', 'P', 'PT', 'P1DT', 'P1W', '1Y',
  '550e8400-e29b-41d4-a716-446655440000', 'not-a-uuid',
  '1.2.3.4', '256.1.1.1', '1.2.3', '01.2.3.4',
  '::1', '1:2:3:4:5:6:7:8', '1:2', 'gggg::1',
  'example.com', 'sub.example.com', '-bad-.com', 'a..b', 'x'.repeat(300),
]

let mismatches = 0
for (const format of FORMATS) {
  const schema = { type: 'string', format }
  const codegen = compileToJSCodegen(schema)
  const interp = createInterpreter(schema)
  assert.ok(codegen, `codegen should compile { format: ${format} }`)

  for (const value of CORPUS) {
    const cg = !!codegen(value)
    const it = interp.validate(value).valid
    if (cg !== it) {
      mismatches++
      console.error(
        `drift: format=${format} value=${JSON.stringify(value)} codegen=${cg} interpreter=${it}`,
      )
    }
  }
}

assert.strictEqual(mismatches, 0, `${mismatches} codegen/interpreter format disagreement(s)`)

// Spot-check the uri strengthening directly so a regression names itself.
{
  const uri = createInterpreter({ type: 'string', format: 'uri' })
  assert.strictEqual(uri.validate('https: not a url').valid, false, 'uri rejects embedded whitespace')
  assert.strictEqual(uri.validate('http://a b.com').valid, false, 'uri rejects space in authority')
  assert.strictEqual(uri.validate('https://ok.com').valid, true, 'uri accepts a real url')
  assert.strictEqual(uri.validate('mailto:a@b.com').valid, true, 'uri accepts mailto')
  assert.strictEqual(uri.validate('urn:isbn:1').valid, true, 'uri accepts urn')
  assert.strictEqual(uri.validate('http://a-b.com/x?y=1#z').valid, true, 'uri accepts hyphenated host with query and fragment')
}

console.log('format engine parity: OK')
