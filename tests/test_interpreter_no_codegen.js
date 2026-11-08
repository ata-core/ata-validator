'use strict'

// A validator asked for the interpreted engine never generates code, so it
// does not load the generator (lib/codegen-engine.js and lib/js-compiler.js,
// 386 KB of source). It loaded it on its first check only to learn that, and
// that was about half of the check in a process that checks once: 5.7 to
// 3.4 ms. Held here in the tick the package was required in, before the
// entry's idle load (index.js) can run.

const assert = require('node:assert')
const { Validator } = require('..')
const loaded = () => Object.keys(require.cache).some((k) => /(codegen-engine|js-compiler)\.js$/.test(k))
assert.strictEqual(loaded(), false, 'the generator is not loaded with the package')

const schema = { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' } }, required: ['id'] }
const v = new Validator(schema, { engine: 'interpreter' })
assert.strictEqual(v.isValidObject({ id: 1 }), true)
assert.strictEqual(v.validate({ id: 'x' }).valid, false)
assert.strictEqual(v.isValidJSON('{"id":2}'), true)
assert.strictEqual(v.validateJSON('{"email":"nope"}').valid, false)
assert.strictEqual(loaded(), false, 'an interpreted validator does not load the generator')
console.log('ok: an interpreted validator answers without loading the code generator')
