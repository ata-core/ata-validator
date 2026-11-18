'use strict'

// removeAdditional with a schema that has no closed object
// (`additionalProperties: false`) removes nothing, so the removal pass and the
// defaults module it reads references with stay unloaded, as the defaults
// module stays unloaded for a schema with no `default`. Loading them for
// nothing cost a Fastify app's first validated request 0.25 ms (ten routes
// with the usual coerceTypes, useDefaults and removeAdditional, 3.9% against
// 1.64.0). Each case runs in a fresh process, since the module cache is
// process-wide.

const assert = require('assert')
const { execFileSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const loaded = (schema, opts) => execFileSync(process.execPath, ['-e', `
  const { Validator } = require(${JSON.stringify(root)})
  const v = new Validator(${JSON.stringify(schema)}, ${JSON.stringify(opts)})
  v.validate({ id: '1', email: 'a@b.cd' })
  console.log(Object.keys(require.cache).filter((k) => /remove-additional|[\\\\/]defaults\\.js$/.test(k)).map((k) => k.split(/[\\\\/]/).pop()).sort().join(','))
`], { encoding: 'utf8' }).trim()

const open = { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, email: { type: 'string' } } }
const closed = { ...open, additionalProperties: false }
const server = { coerceTypes: true, useDefaults: true, removeAdditional: true }

assert.strictEqual(loaded(open, server), '', 'no closed object: neither module loads')
assert.strictEqual(loaded(open, { ...server, engine: 'interpreter' }), '', 'nor on the interpreted engine')
assert.strictEqual(loaded(closed, { ...server, engine: 'interpreter' }), 'defaults.js,remove-additional.js', 'a closed object loads the pass')

console.log('ok: the removal pass loads only for a schema with a closed object')
