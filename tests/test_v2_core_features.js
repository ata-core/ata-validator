'use strict'

// The plugin's core (index.v2.core.mjs) and featuresFor() (index.v2.features.mjs).
// On every group of the official suite, in every dialect, with options varied:
// a core given exactly the features featuresFor() names takes the schema, and
// a core given all of them but one refuses it, naming the one withheld, at the
// first call. Each set of features gets its own copy of the registry and of the
// engine that reads it (as scripts/gate.js loads them), so a refusal cannot be
// hidden by what another schema registered. scripts/gate.js holds the answers
// of such a core to the Validator's ("v2 core + featuresFor").

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const FRESH = ['validator-small.js', 'groups.js', 'engine-small.js'].map((f) => path.join(__dirname, '..', 'lib', f))
let F = null
const cores = new Map()
function coreWith (names) {
  const key = [...names].sort().join(',')
  let V = cores.get(key)
  if (V === undefined) {
    for (const f of FRESH) delete require.cache[f]
    const small = require(FRESH[0]); V = small.Validator
    // As index.v2.core.mjs: with the questions asked before the engine is built.
    small._gate(require('../lib/gates.js'))
    if (names.length) V.use(...names.map((n) => F[n]))
    for (const f of FRESH) delete require.cache[f]
    cores.set(key, V)
  }
  return V
}
const first = (V, s, o, d) => { const v = new V(s, o); v.validate(structuredClone(d)); return v }

;(async () => {
  F = await import(pathToFileURL(path.join(__dirname, '..', 'index.v2.features.mjs')).href)
  const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft7: 'http://json-schema.org/draft-07/schema#', draft6: 'http://json-schema.org/draft-06/schema#', draft4: 'http://json-schema.org/draft-04/schema#', v1: 'https://json-schema.org/v1' }
  const OPTS = [{}, { useDefaults: false }, { assertFormat: false }, { formats: { date: () => true, uri: () => true } }, { verbose: true }]
  let taken = 0; let refused = 0; let named = 0
  const seen = {}
  for (const [dialect, uri] of Object.entries(DIALECTS)) {
    for (const sub of ['', 'optional/format']) {
      const dir = path.join(__dirname, 'suite/tests', dialect, sub)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
          if (JSON.stringify(g.schema).includes('localhost:1234')) continue
          const schema = g.schema !== null && typeof g.schema === 'object' && !('$schema' in g.schema) ? { $schema: uri, ...g.schema } : g.schema
          const d = g.tests[0].data
          for (const o of OPTS) {
            const label = `${dialect}/${sub}${f}: ${g.description} ${JSON.stringify(o)}`
            const names = F.featuresFor(schema, o)
            for (const n of names) seen[n] = (seen[n] || 0) + 1
            first(coreWith(names), schema, o, d)
            taken++
            for (const n of names) {
              const rest = names.filter((x) => x !== n)
              assert.throws(() => first(coreWith(rest), schema, o, d), (e) => e instanceof Error && e.message.startsWith('ata2: ') && e.message.includes('Validator.use(' + n + ')'), `${label}: without ${n}`)
              refused++
            }
            if (names.length) named++
          }
        }
      }
    }
  }
  for (const n of ['formats', 'uri', 'draft7', 'defaults', 'uniqueItems', 'branchCollapse', 'verbose', 'metaschemas']) assert.ok(seen[n] > 0, 'the suite needs ' + n)
  assert.ok(taken > 8000 && refused > 4000, `${taken} schemas taken, ${refused} refusals`)

  // The three ways to give documents: the schemas option and addSchema().
  const doc = { $id: 'https://example.com/d', $schema: 'http://json-schema.org/draft-07/schema#', definitions: { a: { type: 'string', format: 'date' } }, items: [{ uniqueItems: true }] }
  const root = { $ref: 'https://example.com/d#/definitions/a' }
  const viaOption = F.featuresFor(root, { schemas: [doc] })
  const viaAdd = F.featuresFor(root, {}, [doc])
  assert.deepStrictEqual(viaAdd.sort(), viaOption.sort(), 'addSchema() and the schemas option need the same features')
  for (const n of ['draft7', 'formats', 'uniqueItems']) assert.ok(viaOption.includes(n), 'a registered document needs ' + n + ': ' + viaOption)
  for (const n of viaAdd) {
    const V = coreWith(viaAdd.filter((x) => x !== n))
    assert.throws(() => { const v = new V(root, {}); v.addSchema(doc); v.validate('x') }, (e) => e.message.includes('Validator.use(' + n + ')'), 'addSchema() without ' + n)
  }

  // A plain schema needs nothing; the core takes it with nothing registered.
  assert.deepStrictEqual(F.featuresFor({ type: 'object', properties: { a: { type: 'string', minLength: 1 } }, required: ['a'] }), [])
  assert.strictEqual(new (coreWith([]))({ type: 'object', required: ['a'] }).validate({}).errors[0].keyword, 'required')
  // A format the caller gives needs no group.
  assert.deepStrictEqual(F.featuresFor({ format: 'date' }, { formats: { date: () => true } }), [])
  // A keyword the JSON text does not show (not enumerable) is still met where
  // the engine builds it, and refused there.
  const hidden = Object.defineProperty({ type: 'string' }, 'format', { value: 'date', enumerable: false })
  assert.deepStrictEqual(F.featuresFor(hidden), [])
  assert.throws(() => new (coreWith([]))(hidden).validate('x'), { message: 'ata2: formats, Validator.use(formats)' })
  const hiddenUnique = Object.defineProperty({ type: 'array' }, 'uniqueItems', { value: true, enumerable: false })
  assert.throws(() => new (coreWith([]))(hiddenUnique).validate([1, 1]), { message: 'ata2: uniqueItems, Validator.use(uniqueItems)' })
  console.log(`ok: ${taken} schemas taken on the core with featuresFor(), ${named} of them needing a feature; ${refused} refusals with one withheld`)
})().catch((e) => { console.error(e); process.exit(1) })
