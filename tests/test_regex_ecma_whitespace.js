'use strict'

// JSON Schema patterns follow ECMA-262. There, `\s` is WhiteSpace and
// LineTerminator: tab, vertical tab, form feed, space, no-break space, the
// Unicode space separators, U+FEFF, LF, CR, U+2028 and U+2029. `.` matches
// anything but a line terminator. ata's linear-time engine stopped `\s` at
// U+00A0 and let `.` match CR, U+2028 and U+2029; the native addon's RE2 does
// the same on the large-text and buffer paths. So `^\S+$` accepted a string
// holding U+2028 or U+3000, and `^.+$` one holding a carriage return.
//
// Held here against the platform's own RegExp with the `u` flag: the engine on
// a corpus of patterns and inputs, then every path a validator can answer by.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { compileSafe } = require('../lib/safe-regex')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

const SPECIAL = ['\t', '\n', '\u000b', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2000', '\u2005', '\u200a', '\u200b', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', '\u0085']
const inputs = ['', 'ab', 'a b']
for (const c of SPECIAL) inputs.push(c, `a${c}b`, `${c}${c}`)

const patterns = ['^\\s$', '^\\S$', '^\\s+$', '^\\S+$', '^.$', '^.+$', '^a.b$', '^[\\s]$', '^[^\\s]$', '^[\\s\\w]+$', '^[ \\S]+$', '\\s', '\\S', '.', '^\\s*\\S+\\s*$', '^(a|\\s)+$']

let engine = 0
for (const p of patterns) {
  // A pattern the engine does not take (`\S` inside a class) is compiled to
  // the platform RegExp instead; the path checks below cover it.
  let safe
  try { safe = compileSafe(p) } catch { continue }
  const native = new RegExp(p, 'u')
  for (const x of inputs) {
    assert.strictEqual(safe.test(x), native.test(x), `engine ${JSON.stringify(p)} on ${JSON.stringify(x)}`)
    engine++
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-ecma-ws-'))
let paths = 0
patterns.forEach((p, i) => {
  const schema = { type: 'string', pattern: p }
  const fast = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  const file = path.join(dir, `m${i}.cjs`)
  fs.writeFileSync(file, toStandaloneModule(schema, { format: 'cjs' }))
  const aot = require(file)
  for (const x of inputs) {
    const want = new RegExp(p, 'u').test(x)
    const text = JSON.stringify(x)
    // Leading whitespace puts the same document on the large-text path.
    const big = ' '.repeat(9000) + text
    const got = {
      validate: fast.validate(x).valid,
      interpreter: interp.validate(x).valid,
      aot: aot.isValid(x),
      validateJSON: fast.validateJSON(big).valid,
      isValidJSON: fast.isValidJSON(big),
    }
    try { got.buffer = fast.isValid(Buffer.from(text)) } catch { /* no native addon */ }
    for (const [k, v] of Object.entries(got)) {
      assert.strictEqual(v, want, `${k} ${JSON.stringify(p)} on ${JSON.stringify(x)}`)
      paths++
    }
  }
})
fs.rmSync(dir, { recursive: true, force: true })

console.log(`ok: \\s and . follow ECMA-262 in the engine (${engine} checks) and on every path (${paths} checks)`)
