'use strict'

// A version bump leaves the local addon reporting the old version, the loader
// ignores it with a warning, and every test silently runs on pure JS. Green
// runs then say nothing about the native engine. This test turns that into a
// failure: when a build of the addon exists next to this checkout, it must be
// the one that loads.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

console.log('native engine loaded\n')

const built = path.join(__dirname, '..', 'build', 'Release', 'ata.node')
if (process.env.ATA_NO_NATIVE) {
  console.log('  skipped: ATA_NO_NATIVE is set\n')
  process.exit(0)
}
if (!fs.existsSync(built)) {
  console.log('  skipped: no local build (run `npm run build`)\n')
  process.exit(0)
}

const loadNative = require('../lib/native-load')
const binding = loadNative()
assert.ok(binding, 'a built addon exists but the loader returned nothing; rebuild with `npm run build` after a version bump')

const expected = require('../package.json').version
const reported = typeof binding.version === 'function' ? binding.version() : binding.version
assert.strictEqual(reported, expected, `addon reports ${reported}, package is ${expected}`)

// And the public API must actually use it.
const { Validator } = require('..')
const v = new Validator({ type: 'object', required: ['a'], properties: { a: { type: 'integer' } } })
assert.strictEqual(v.isValid(Buffer.from('{"a":1}')), true)
assert.strictEqual(v.isValid(Buffer.from('{"a":"x"}')), false)

console.log(`  PASS  native ${reported} loaded and answering\n`)
