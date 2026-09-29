'use strict'

// Run by the prebuild workflow on the binary that ships, after strip and
// signing: the local build must be the addon that loads, and it must answer.

const { spawnSync } = require('child_process')
const path = require('path')

const loaded = spawnSync(process.execPath, [path.join(__dirname, '..', 'tests', 'test_native_loaded.js')], { stdio: 'inherit' })
if (loaded.status !== 0) process.exit(1)

const { Validator } = require('..')
const v = new Validator({ type: 'object', required: ['a'] })
const ok = v.isValid(Buffer.from('{"a":1}')) === true && v.isValid(Buffer.from('{}')) === false
if (!ok) {
  console.error('the native addon loaded but answered wrongly')
  process.exit(1)
}
console.log('ok: the shipped addon loads and answers')
