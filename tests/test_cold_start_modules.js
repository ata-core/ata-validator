'use strict'

// The modules a process loads to answer its first request on an ordinary
// schema: require, construct, accept, reject and read the errors. Every
// module on this path is parsed in every process, serverless starts
// included, so one that joins it should be a decision, not a side effect.
// lib/defaults.js joined it unnoticed and cost 0.07 ms of every start; it
// now loads only for a schema with defaults, which the second half checks.
// lib/error-messages.js loads only for a schema with `errorMessage`, which
// the third half checks; loading it to ask cost 0.1 ms of a ten-route boot.
//
// When this fails because a module was added on purpose, measure the cold
// start against the previous tag and update the list.

const assert = require('assert')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const EXPECTED = [
  'index.js',
  'lib/combined-runtime.js',
  'lib/diagnostic-source.js',
  'lib/dialect.js',
  'lib/draft7.js',
  'lib/enrich-error.js',
  'lib/error-codes.js',
  'lib/formats-source.js',
  'lib/formats.js',
  'lib/js-compiler.js',
  'lib/keywords.js',
  'lib/levenshtein.js',
  'lib/pointer.js',
  'lib/rejections.js',
  'lib/safe-regex.js',
  'lib/schema-order.js',
  'lib/schema-scan.js',
  'lib/shape-classifier.js',
  'lib/suggestions.js',
  'lib/tier0.js',
  'lib/validator-core.js',
  'lib/vocabularies.js',
]

// A fresh process each, so nothing this test file loaded counts.
function loadedBy (body) {
  const src = `
    const path = require('path')
    const { Validator } = require(${JSON.stringify(root)})
    ${body}
    console.log(JSON.stringify(Object.keys(require.cache).filter((f) => f.startsWith(${JSON.stringify(root + path.sep)})).map((f) => path.relative(${JSON.stringify(root)}, f).split(path.sep).join('/')).sort()))
  `
  const r = spawnSync(process.execPath, ['-e', src], { encoding: 'utf8' })
  assert.strictEqual(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

const plain = loadedBy(`
  const v = new Validator({ type: 'object', properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string' } }, required: ['id'] })
  if (!v.validate({ id: 1 }).valid) throw new Error('accept')
  if (!v.validate({}).errors[0].message) throw new Error('errors')
  if (!v.isValidObject({ id: 2 })) throw new Error('verdict')
`)
assert.deepStrictEqual(plain.filter((f) => !EXPECTED.includes(f)), [], 'modules joined the cold path')
assert.deepStrictEqual(EXPECTED.filter((f) => !plain.includes(f)), [], 'modules left the cold path; update the list')

// With defaults the closure pass loads, where the generated pass is not
// available, and still fills them in.
const withDefaults = loadedBy(`
  const v = new Validator({ type: 'object', properties: { page: { type: 'integer', default: 1 } } }, { engine: 'interpreter' })
  const d = {}
  v.validate(d)
  if (d.page !== 1) throw new Error('default not applied: ' + JSON.stringify(d))
`)
assert.ok(withDefaults.includes('lib/defaults.js'), 'a schema with defaults on the interpreter loads the defaults pass')

const withMessages = loadedBy(`
  const v = new Validator({ type: 'object', properties: { n: { type: 'integer', errorMessage: 'n must be a whole number' } } })
  const r = v.validate({ n: 'x' })
  if (r.errors[0].message !== 'n must be a whole number') throw new Error('errorMessage not applied: ' + r.errors[0].message)
`)
assert.ok(withMessages.includes('lib/error-messages.js'), 'a schema with errorMessage loads its module and applies the message')

console.log(`ok: an ordinary schema's first answers load the ${EXPECTED.length} expected modules and no others`)
