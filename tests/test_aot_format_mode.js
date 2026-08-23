'use strict'

// Custom formats in standalone output. 'embed' serializes the function and
// must refuse one that would not survive serialization; 'inject' emits no
// function source and exports setFormats() instead.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { toStandaloneModule } = require('../build')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-fmt-'))
const load = (name, src) => { const f = path.join(dir, name); fs.writeFileSync(f, src); return require(f) }
const schema = { type: 'object', properties: { code: { type: 'string', format: 'zip-tr' } } }
const formats = { 'zip-tr': (s) => /^[0-9]{5}$/.test(s) }

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

console.log('standalone custom formats\n')

check('inject: module exports setFormats and throws by name before it is called', () => {
  const src = toStandaloneModule(schema, { formats, format: 'cjs', formatMode: 'inject' })
  assert.ok(!/\[0-9\]\{5\}/.test(src), 'function source must not be embedded')
  const m = load('inject.js', src)
  assert.throws(() => m.validate({ code: '35000' }), /zip-tr.*not registered/)
  m.setFormats(formats)
  assert.strictEqual(m.validate({ code: '35000' }).valid, true)
  assert.strictEqual(m.validate({ code: 'x' }).valid, false)
  assert.strictEqual(m.isValid({ code: 'x' }), false)
})

check('inject: esm output exports setFormats', () => {
  const src = toStandaloneModule(schema, { formats, format: 'esm', formatMode: 'inject' })
  assert.ok(/export \{ validate, isValid, setFormats \}/.test(src))
})

check('inject: bundleStandalone and bundleCompact share one registry', () => {
  for (const [name, fn] of [['bs.js', Validator.bundleStandalone], ['bc.js', Validator.bundleCompact]]) {
    const m = load(name, fn([schema, { type: 'string', format: 'zip-tr' }], { formats, format: 'cjs', formatMode: 'inject' }))
    assert.strictEqual(typeof m.setFormats, 'function', name)
    m.setFormats(formats)
    assert.strictEqual(m[0]({ code: '35000' }).valid, true, name)
    assert.strictEqual(m[0]({ code: 'x' }).valid, false, name)
    assert.strictEqual(m[1]('35000').valid, true, name)
    assert.strictEqual(m[1]('x').valid, false, name)
  }
})

check('embed: a plain function still embeds and works', () => {
  const m = load('embed.js', toStandaloneModule(schema, { formats, format: 'cjs' }))
  assert.strictEqual(m.validate({ code: '35000' }).valid, true)
  assert.strictEqual(m.validate({ code: 'x' }).valid, false)
})

check('embed: coverage-instrumented source is refused with the format name', () => {
  const instrumented = { 'zip-tr': function (s) { cov_1abc.s[0]++; return s.length === 5 } } // eslint-disable-line no-undef
  assert.throws(() => toStandaloneModule(schema, { formats: instrumented, format: 'cjs' }), /"zip-tr" is instrumented/)
})

check('embed: a bound function is refused with the format name', () => {
  assert.throws(() => toStandaloneModule(schema, { formats: { 'zip-tr': formats['zip-tr'].bind(null) }, format: 'cjs' }), /"zip-tr" has no standalone source/)
})

console.log(`\n${passed} passed`)
