'use strict'

// `parseJSON` is exported and documented as simdjson where the addon is
// there and JSON.parse otherwise. The addon stopped exporting parseJSON long
// ago, so with the engine loaded the function threw "native.parseJSON is not
// a function" on every call; without it the bug was invisible, which is how
// it lived on. Held here with the engine in the state the test runner has.

const assert = require('node:assert')
const { parseJSON } = require('..')

assert.deepStrictEqual(parseJSON('{"a":[1,2,{"b":null}],"c":"d"}'), { a: [1, 2, { b: null }], c: 'd' })
assert.deepStrictEqual(parseJSON(Buffer.from('[1,"x",true]')), [1, 'x', true])
assert.throws(() => parseJSON('{"a":'), SyntaxError)
const native = require('../lib/native-load.js')()
console.log(`ok: parseJSON answers with the native engine ${native ? 'loaded' : 'absent'}`)
