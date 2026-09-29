'use strict'

// Standalone modules embed the linear-time regex engine as the text of the
// engine's own function (lib/safe-regex.js), so there is one source and no
// generated copy to drift. This holds the embed to the engine it came from:
// modules built for patterns the platform RegExp and the inline compiler do
// not take carry the engine, import nothing, and answer as the runtime engine
// does.

const assert = require('assert')
const { compileSafe } = require('../lib/safe-regex')
const { toStandaloneModule } = require('../build')

const patterns = ['^(\\w+\\s?)+$', '^[\\w ]+$', '^(a|aa)+$', '^[a-z]{0,1000}$', '(?:ab)*c', '^(\\d+-)*\\d+$', 'a+b', '^.{2,}$']
const inputs = ['', 'a', 'aa', 'ab c', 'a　b', 'a\rb', '123-4567', 'ababc', 'x'.repeat(40) + '!', 'é', 'aab', '1-2-3']
let embedded = 0, compared = 0
for (const p of patterns) {
  const src = toStandaloneModule({ type: 'string', pattern: p }, { format: 'cjs' })
  assert.ok(!/require\(|\bimport /.test(src), 'the module for ' + p + ' imports nothing')
  if (src.includes('__ataSafeRe')) embedded++
  const m = { exports: {} }
  new Function('module', 'exports', src)(m, m.exports)
  const ref = compileSafe(p)
  for (const x of inputs) {
    assert.strictEqual(m.exports.isValid(x), ref.test(x), JSON.stringify(p) + ' on ' + JSON.stringify(x))
    compared++
  }
}
assert.ok(embedded >= 4, 'only ' + embedded + ' modules carried the engine')
console.log(`ok: ${embedded} modules carry the regex engine, and ${compared} answers match lib/safe-regex.js`)
