'use strict'

// lib/metaschemas.js is written by scripts/gen-metaschemas.js from the
// meta-schemas as fetched. This fails when the file was edited by hand, or
// when the dialect rewrite (lib/draft7.js) changed and the file was not
// written again: run `node scripts/gen-metaschemas.js`.

const assert = require('node:assert')
const fs = require('node:fs')
const { source, OUT } = require('../scripts/gen-metaschemas.js')

assert.ok(fs.readFileSync(OUT, 'utf8') === source(), 'lib/metaschemas.js is not what scripts/gen-metaschemas.js writes; run it')
const { METASCHEMAS } = require('../lib/metaschemas')
assert.strictEqual(METASCHEMAS.size, 18)
console.log('test_metaschemas_generated: ok')
