'use strict'

// The per-feature exports of the 2.0 Validator (package.json "exports", the
// pattern ./features/* over lib/features/*.js, imported by name):
// ata-validator/features/<name> for each feature and featuresFor() from
// ata-validator/features. Each resolves through the package's own exports,
// registers on the plugin's core (lib/validator-small.js, a copy of its own
// per feature, since a registration is the module's), and turns a refusal
// naming it into an answer. A bundle of one export carries that feature's
// module and no other's, and one of featuresFor() carries none but the two
// it reads (draft7, metaschemas).

const assert = require('node:assert')
const path = require('node:path')
const esbuild = require('esbuild')
const { execFileSync } = require('node:child_process')
const { TSC_JS } = require('./_tsc.js')

const ROOT = path.join(__dirname, '..')
const FRESH = ['validator-small.js', 'groups.js', 'engine-small.js'].map((f) => path.join(ROOT, 'lib', f))
const fresh = () => { for (const f of FRESH) delete require.cache[f]; const V = require(FRESH[0]).Validator; for (const f of FRESH) delete require.cache[f]; return V }

// For each export name: the file under lib/features/, a schema and options
// that need it, and a document to check.
const { NAMES, featureOf } = require('../lib/gates.js')
const URI = ['uri', 'uri-reference', 'iri', 'iri-reference']
// The formats and uri groups, which featuresFor() no longer names: each
// stands for every per-name feature it holds.
const GROUPS = { formats: NAMES.filter((n) => !URI.includes(n)), uri: URI }
const CASES = {
  ...Object.fromEntries(NAMES.map((n) => [featureOf(n), [featureOf(n) + '.js', { format: n }, {}, 'x y']])),
  draft7: ['draft7.js', { $schema: 'http://json-schema.org/draft-07/schema#', items: [{ type: 'string' }] }, {}, [1]],
  defaults: ['defaults.js', { properties: { a: { default: 1 } } }, {}, {}],
  uniqueItems: ['uniqueItems.js', { uniqueItems: true }, {}, [1, 1]],
  branchCollapse: ['branchCollapse.js', { anyOf: [{ type: 'string' }] }, {}, 1],
  richErrors: ['richErrors.js', { type: 'string' }, { richErrors: true }, 1],
  verbose: ['verbose.js', { type: 'string' }, { verbose: true }, 1],
  metaschemas: ['metaschemas.js', { $ref: 'https://json-schema.org/draft/2020-12/schema' }, {}, { type: 1 }],
  errorMessages: ['errorMessages.js', { type: 'string', errorMessage: 'a string' }, {}, 1],
  coerceTypes: ['coerceTypes.js', { type: 'number' }, { coerceTypes: true }, '1'],
  removeAdditional: ['removeAdditional.js', { type: 'object', additionalProperties: false }, { removeAdditional: true }, { a: 1 }],
  codegen: ['codegen.js', null, null, null],
}

;(async () => {
  const index = await import('ata-validator/features')
  // The groups still register every name they hold, for a caller that has
  // not moved to the per-name features.
  for (const [g, names] of Object.entries(GROUPS)) {
    const m = await import('ata-validator/features/' + g)
    assert.strictEqual(require.resolve('ata-validator/features/' + g), path.join(ROOT, 'lib/features', g + '.js'), g + ': resolves to lib/features/' + g + '.js')
    for (const n of names) {
      assert.deepStrictEqual(index.featuresFor({ format: n }), [featureOf(n)], n + ': featuresFor() names ' + featureOf(n))
      const V = fresh()
      assert.throws(() => new V({ format: n }).validate('x'), (e) => e.message === `ata2: ${featureOf(n)}, Validator.use(${featureOf(n)})`, n + ': refused without ' + g)
      V.use(m[g])
      assert.strictEqual(typeof new V({ format: n }).validate('x y').valid, 'boolean', n + ': answered with ' + g)
    }
  }
  assert.strictEqual(typeof index.featuresFor, 'function', 'ata-validator/features exports featuresFor')
  for (const [name, [file, schema, opts, doc]] of Object.entries(CASES)) {
    const m = await import('ata-validator/features/' + name)
    assert.ok(m[name] && typeof m[name] === 'object', name + ': exported by name')
    // The export is the CommonJS module itself, no layer over it.
    assert.strictEqual(require.resolve('ata-validator/features/' + name), path.join(ROOT, 'lib/features', name + '.js'), name + ': resolves to lib/features/' + name + '.js')
    assert.strictEqual(m[name], require(path.join(ROOT, 'lib/features', file))[name], name + ': the feature of lib/features/' + file)
    const V = fresh()
    if (name === 'codegen') {
      V.use(m.codegen)
      assert.strictEqual(await new V({ type: 'string' })._tierUp(), true, 'codegen: registered, a validator tiers up')
      continue
    }
    // The others a schema needs come from their own exports too.
    const names = index.featuresFor(schema, opts)
    assert.ok(names.includes(name), name + ': named by featuresFor: ' + names)
    const others = await Promise.all(names.filter((n) => n !== name).map(async (n) => (await import('ata-validator/features/' + n))[n]))
    if (others.length) V.use(...others)
    assert.throws(() => new V(schema, opts).validate(structuredClone(doc)), (e) => e.message.startsWith('ata2: ') && e.message.includes('Validator.use(' + name + ')'), name + ': refused without it')
    V.use(m[name])
    const r = new V(schema, opts).validate(structuredClone(doc))
    assert.strictEqual(typeof r.valid, 'boolean', name + ': answered once registered')
  }

  // What a bundle of each export carries, from the package's exports as a page's bundler reads them.
  const carried = async (spec) => {
    const r = await esbuild.build({ stdin: { contents: `export * from ${JSON.stringify(spec)}`, resolveDir: ROOT }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' })
    return Object.keys(r.metafile.inputs).map((f) => f.replace(/^.*?lib\//, 'lib/'))
  }
  const own = Object.fromEntries(Object.entries(CASES).map(([n, [f]]) => [n, 'lib/features/' + f]))
  for (const g of Object.keys(GROUPS)) own[g] = 'lib/features/' + g + '.js'
  for (const name of Object.keys(own)) {
    const files = await carried('ata-validator/features/' + name)
    // A group is one module; the uri group reads the formats group's.
    const mine = (other) => other === name || (name === 'uri' && other === 'formats')
    for (const [other, f] of Object.entries(own)) assert.strictEqual(files.includes(f), mine(other), `ata-validator/features/${name} ${mine(other) ? 'carries' : 'leaves out'} ${f}`)
  }
  // A per-name feature carries the shared parts its check reads, and no other.
  const parts = (files) => files.filter((f) => f.startsWith('lib/fmt/')).sort()
  assert.deepStrictEqual(parts(await carried('ata-validator/features/formatDate')), ['lib/fmt/pair.js'])
  assert.deepStrictEqual(parts(await carried('ata-validator/features/formatTime')), [])
  assert.ok(!(await carried('ata-validator/features/formatUriReference')).includes('lib/fmt/URI_FAST.js'), 'formatUriReference leaves out URI_FAST')
  const files = await carried('ata-validator/features')
  for (const [other, f] of Object.entries(own)) assert.strictEqual(files.includes(f), other === 'draft7' || other === 'metaschemas', `ata-validator/features and ${f}`)
  for (const f of ['lib/enrich-error.js', 'lib/fmt/ipv6.js', 'lib/unique-dup.js', 'lib/branch-collapse.js', 'lib/defaults.js', 'lib/mutators.js']) assert.ok(!files.includes(f), 'ata-validator/features leaves out ' + f)
  // The declarations.
  execFileSync(process.execPath, [TSC_JS, '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', path.join(__dirname, 'feature_exports_types.ts')], { cwd: ROOT, stdio: 'inherit' })
  console.log(`ok: ${Object.keys(CASES).length} feature exports resolve and register; featuresFor() carries draft7 and the meta-schemas only; the declarations type-check`)
})().catch((e) => { console.error(e); process.exit(1) })
