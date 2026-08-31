'use strict'

// An error means the same thing whichever engine produced it. The native
// engine reports its own `error_code` enum from include/ata.h as an ordinal,
// and that ordinal used to reach callers untranslated: a type error came back
// as `code: 3` with no `keyword` and a docUrl pointing at a page that does not
// exist, while the same failure from the JavaScript engines came back as
// ATA1001. These tests hold the translation, and hold the table against the
// enum it mirrors.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { fromNative, NATIVE_KEYWORDS, CODES } = require('../lib/error-codes')
const { enrich } = require('../lib/enrich-error')

let pass = 0
function ok (name, fn) {
  fn()
  pass++
  console.log('  PASS ', name)
}

ok('the table matches the enum in include/ata.h, in order', () => {
  const header = fs.readFileSync(path.join(__dirname, '..', 'include', 'ata.h'), 'utf8')
  const block = header.match(/enum class error_code : uint8_t \{([\s\S]*?)\}/)
  assert.ok(block, 'error_code enum not found in include/ata.h')
  const names = block[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
    .filter(Boolean)
    .map((l) => l.split('=')[0].trim())
  assert.strictEqual(
    names.length,
    NATIVE_KEYWORDS.length,
    `include/ata.h declares ${names.length} error codes, the table has ${NATIVE_KEYWORDS.length}`,
  )
  assert.strictEqual(names[0], 'ok')
  assert.strictEqual(names[3], 'type_mismatch')
  assert.strictEqual(NATIVE_KEYWORDS[3], 'type')
})

ok('every mapped keyword resolves to a code that exists', () => {
  for (let i = 1; i < NATIVE_KEYWORDS.length; i++) {
    const got = fromNative(i)
    assert.ok(got, `ordinal ${i} has no mapping`)
    assert.ok(CODES[got.code], `${got.code} is not a documented code`)
    assert.strictEqual(typeof got.keyword, 'string')
  }
})

ok('ok and out-of-range ordinals map to nothing', () => {
  assert.strictEqual(fromNative(0), null)
  assert.strictEqual(fromNative(NATIVE_KEYWORDS.length), null)
  assert.strictEqual(fromNative(1.5), null)
  assert.strictEqual(fromNative('3'), null)
  assert.strictEqual(fromNative(undefined), null)
})

ok('a format failure without a named format gets the generic code', () => {
  assert.strictEqual(fromNative(15).code, 'ATA3099')
  assert.strictEqual(fromNative(15, 'email').code, 'ATA3001')
})

ok('enrich translates a native error into the documented shape', () => {
  const out = enrich({ code: 3, message: 'expected type string, got integer', path: '/name' })
  assert.strictEqual(out.code, 'ATA1001')
  assert.strictEqual(out.keyword, 'type')
  assert.strictEqual(out.docUrl, 'https://ata-validator.com/e/ATA1001')
  assert.strictEqual(out.path, '/name')
})

ok('a code the JavaScript engines set is left alone', () => {
  const out = enrich({ code: 'ATA7002', keyword: 'additionalProperties', instancePath: '', params: {} })
  assert.strictEqual(out.code, 'ATA7002')
  assert.strictEqual(out.keyword, 'additionalProperties')
})

ok('a recursive schema reports the same code on every engine', () => {
  const { execFileSync } = require('child_process')
  const schema = {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, subs: { type: 'array', items: { $ref: '#' } } },
  }
  const script = `
    const { Validator } = require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))})
    const v = new Validator(${JSON.stringify(schema)})
    const e = v.validate({ name: 42, subs: [] }).errors[0]
    console.log(JSON.stringify({ code: e.code, keyword: e.keyword, path: e.path, docUrl: e.docUrl }))
  `
  const run = (env) =>
    JSON.parse(
      execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        timeout: 60000,
        env: Object.assign({}, process.env, env),
      }).trim().split('\n').pop(),
    )

  const asInstalled = run({})
  const pureJs = run({ ATA_NO_NATIVE: '1' })
  for (const got of [asInstalled, pureJs]) {
    assert.strictEqual(got.code, 'ATA1001')
    assert.strictEqual(got.keyword, 'type')
    assert.strictEqual(got.path, '/name')
    assert.strictEqual(got.docUrl, 'https://ata-validator.com/e/ATA1001')
  }
})

ok('the error generator declines a self-reference rather than accepting it', () => {
  const { compileToJSCodegenWithErrors } = require('../lib/js-compiler')
  // Behind `$ref: "#"` this schema forbids unknown keys at every level. The
  // generator has no path-relative recursive entry, and used to emit nothing
  // for the reference, which accepted every nested document.
  const schema = { properties: { foo: { $ref: '#' } }, additionalProperties: false }
  assert.strictEqual(compileToJSCodegenWithErrors(schema, new Map(), null), null)

  const { Validator } = require('../index.js')
  const v = new Validator(schema)
  assert.strictEqual(v.validate({ foo: { bar: false } }).valid, false)
  assert.strictEqual(v.validate({ foo: { foo: false } }).valid, true)
})

console.log(`${pass}/8 native error code tests passed.`)
