'use strict'

// The native addon loads on first use, not when the package is required.
// Loading it cost about 1.9 ms of a 9.7 ms serverless start, measured on a
// Hono app under Bun, for every process that never calls a buffer API. The
// witness is the module cache: the loader must not be in it until something
// that needs the addon runs.

const assert = require('assert')
const path = require('path')

const loader = path.join(__dirname, '..', 'lib', 'native-load.js')
const loaded = () => Object.prototype.hasOwnProperty.call(require.cache, loader)

const { Validator } = require('..')
const v = new Validator({ type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] })
assert.strictEqual(v.validate({ id: 1 }).valid, true)
assert.strictEqual(v.validate({}).valid, false)
assert.strictEqual(v.validate({}).errors.length, 1)
assert.strictEqual(v.isValidObject({ id: 2 }), true)
assert.strictEqual(v.validateJSON('{"id":3}').valid, true)
assert.strictEqual(v.isValidJSON('{"id":"x"}'), false)
assert.strictEqual(v.validateAndParse('{"id":4}').valid, true)
assert.strictEqual(loaded(), false, 'validating loaded the native addon')

let threw = null
try { v.isValid(Buffer.from('{"id":5}')) } catch (e) { threw = e }
assert.strictEqual(loaded(), true, 'a buffer call is what loads it')
if (threw) assert.match(threw.message, /Native addon required for isValid\(\)/)
console.log(`ok: the native addon loads on the first buffer call, not before (${threw ? 'not installed here' : 'installed and answering'})`)
