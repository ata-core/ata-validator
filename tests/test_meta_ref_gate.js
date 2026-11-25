'use strict'

// Which references make the 2.0 Validator load the official meta-schemas
// (META_REF, lib/validator-small.js): the absolute URI of a meta-schema or of one of
// its vocabulary documents, and nothing else on json-schema.org or beside it.
//
// - A table of URIs that ask for the meta-schemas and of URIs that do not.
// - The suite's documents whose own $id is on test.json-schema.org, each
//   registered and reached by a $ref to that $id: taken without the
//   metaschemas feature by the plugin's core, the browser entry and the edge
//   entry, with the suite's verdicts.
// - Every suite group that references a meta-schema: refused without the
//   feature by all three, naming it, and answered with it as the suite says.
// - Every schema of the suite and of SchemaStore, given directly and
//   registered behind a $ref to its $id: the run-time gate of each entry,
//   featuresFor() and the core's fact walk answer alike, and as a reading of
//   the references that does not use the expression (the URL parser).
//
// SchemaStore is read from ATA_SCHEMASTORE, or from ../schemastore when it is
// there; without it the last part covers the suite only and says so.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const lib = (f) => path.join(ROOT, 'lib', f)
// The Validator's expression, read from its source (it is not exported: an
// export would be bytes on every page). The full entries' Validator holds
// the generated copy, and the verdict core none: it hands the references
// over for the Validator to judge.
const metaRefOf = (f) => /^const META_REF = \/(.+)\/;$/m.exec(fs.readFileSync(lib(f), 'utf8'))[1]
const META_REF = new RegExp(metaRefOf('validator-small.js'))
assert.strictEqual(metaRefOf('validator-full.js'), META_REF.source, 'lib/validator-full.js holds the same expression')
for (const f of ['core/verdict.js', 'core/verdict-more.js', 'core/feature.js', 'engine-small.js', 'engine-full.js']) assert.ok(!/json-schema\\\.org/.test(fs.readFileSync(lib(f), 'utf8')), 'lib/' + f + ' holds no expression of its own')
const coreText = require('../lib/core/feature.js')
const { facts } = require('../lib/core/verdict.js')

// A copy of a module with its own registry of features.
const SMALL = ['validator-small.js', 'groups.js', 'engine-small.js'].map(lib)
function fresh (files) {
  for (const f of files) delete require.cache[f]
  const V = require(files[0]).Validator
  for (const f of files) delete require.cache[f]
  return V
}

// The targets by the specification's own layout, read with the URL parser.
const OLD = new Set(['/draft-03/schema', '/draft-04/schema', '/draft-06/schema', '/draft-07/schema'])
function isMetaTarget (ref) {
  let u; try { u = new URL(ref) } catch { return false }
  if (!/^https?:\/\//.test(ref) || u.host !== 'json-schema.org' || u.search !== '') return false
  if (OLD.has(u.pathname)) return true
  const p = u.pathname.split('/')
  if (p.length < 4 || p[0] !== '' || p[1] !== 'draft' || (p[2] !== '2019-09' && p[2] !== '2020-12')) return false
  return (p.length === 4 && p[3] === 'schema') || (p.length === 5 && p[3] === 'meta' && /^[\w-]+$/.test(p[4]))
}
const REF_KEYS = new Set(['$ref', '$dynamicRef', '$recursiveRef'])
function refsMeta (n) {
  if (n === null || typeof n !== 'object') return false
  for (const k of Object.keys(n)) {
    const v = n[k]
    if (typeof v === 'string' ? REF_KEYS.has(k) && isMetaTarget(v) : refsMeta(v)) return true
  }
  return false
}

const YES = [
  'http://json-schema.org/draft-03/schema', 'http://json-schema.org/draft-03/schema#',
  'http://json-schema.org/draft-04/schema', 'http://json-schema.org/draft-04/schema#', 'https://json-schema.org/draft-04/schema#',
  'http://json-schema.org/draft-06/schema', 'http://json-schema.org/draft-06/schema#',
  'http://json-schema.org/draft-07/schema', 'http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft-07/schema',
  'http://json-schema.org/draft-07/schema#/definitions/nonNegativeInteger',
  'https://json-schema.org/draft/2019-09/schema', 'https://json-schema.org/draft/2019-09/schema#', 'http://json-schema.org/draft/2019-09/schema',
  'https://json-schema.org/draft/2019-09/meta/core', 'https://json-schema.org/draft/2019-09/meta/format',
  'https://json-schema.org/draft/2020-12/schema', 'https://json-schema.org/draft/2020-12/schema#/$defs/x',
  'https://json-schema.org/draft/2020-12/meta/core', 'https://json-schema.org/draft/2020-12/meta/meta-data',
  'https://json-schema.org/draft/2020-12/meta/format-annotation', 'https://json-schema.org/draft/2020-12/meta/validation#/$defs/stringArray',
]
const NO = [
  'https://test.json-schema.org/typical-dynamic-resolution/root', 'https://test.json-schema.org/draft/2020-12/schema',
  'https://json-schema.org/', 'https://json-schema.org/draft/2020-12/', 'https://json-schema.org/draft/2020-12/schemas', 'https://json-schema.org/draft/2020-12/schema/x',
  'https://json-schema.org/draft/2020-12/vocab/core', 'https://json-schema.org/draft/2020-12/output/schema', 'https://json-schema.org/draft/2020-12/meta/', 'https://json-schema.org/draft/2020-12/meta/core/x',
  'https://json-schema.org/draft/2018-01/schema', 'https://json-schema.org/draft-07/schemas', 'http://json-schema.org/draft-05/schema#', 'http://json-schema.org/draft-07/hyper-schema#',
  'https://json-schema.org/learn/examples/address.schema.json', 'https://json-schema.org/v1', 'https://json-schema.org/draft/next/schema',
  'https://example.com/json-schema.org/draft-07/schema', 'https://example.com/?u=http://json-schema.org/draft-07/schema#', 'https://notjson-schema.org/draft-07/schema', 'https://json-schema.org.example.com/draft-07/schema',
  'ftp://json-schema.org/draft-07/schema', '//json-schema.org/draft-07/schema', 'json-schema.org/draft-07/schema', 'draft-07/schema', 'schema', '#/definitions/a',
]

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft7: 'http://json-schema.org/draft-07/schema#', draft6: 'http://json-schema.org/draft-06/schema#', draft4: 'http://json-schema.org/draft-04/schema#', draft3: 'http://json-schema.org/draft-03/schema#', v1: 'https://json-schema.org/v1' }
const jsonFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? jsonFiles(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : [])
const isDoc = (s) => s !== null && typeof s === 'object' && !Array.isArray(s)
// A schema as a registered document reached by a $ref to its $id, as
// scripts/gate.js builds its "schemas map" path.
function behindRef (s) {
  const id = typeof s.$id === 'string' && s.$id !== '' && s.$id[0] !== '#' ? s.$id : 'https://example.com/gate-root.json'
  const doc = id === s.$id ? s : { ...s, $id: id }
  return [typeof s.$schema === 'string' ? { $schema: s.$schema, $ref: id } : { $ref: id }, { schemas: [doc] }]
}

;(async () => {
  const F = await import(pathToFileURL(path.join(ROOT, 'index.v2.features.mjs')).href)
  const names = Object.keys(F).filter((k) => F[k] !== null && typeof F[k] === 'object' && !['metaschemas', 'standardSchema', 'codegen'].includes(k))

  // Each entry twice, with its own registry: without the metaschemas feature
  // and with it. The core has every other feature; the full entries carry
  // the schema-decided groups built in.
  const entry = (make) => { const without = make(); const withMeta = make(); withMeta.use(F.metaschemas); return { without, with: withMeta } }
  const ENTRIES = {
    core: entry(() => { const V = fresh(SMALL); V.use(...names.map((n) => F[n])); return V }),
    browser: entry(() => fresh([lib('validator-full.js')])),
    edge: entry(() => { const V = class extends fresh([lib('validator-full.js')]) {}; V.prototype.core = coreText; return V }),
  }
  const REFUSAL = 'ata2: metaschemas, Validator.use(metaschemas)'
  // 'meta' where the entry refuses for the meta-schemas, 'other' where it
  // throws anything else, the validator where it builds.
  const build = (V, s, o) => { try { const v = new V(s, o); v.isValidObject(null); return v } catch (e) { return e instanceof Error && e.message === REFUSAL ? 'meta' : 'other' } }

  // ---- the table ----
  for (const [list, want] of [[YES, true], [NO, false]]) {
    for (const uri of list) {
      assert.strictEqual(isMetaTarget(uri), want, uri + ': the table and the URL reading disagree')
      for (const k of REF_KEYS) {
        const s = { [k]: uri }
        assert.strictEqual(META_REF.test(JSON.stringify(s)), want, `${k} ${uri}: META_REF`)
        assert.strictEqual(META_REF.test(facts(s).metaRef), want, `${k} ${uri}: the core's fact`)
        assert.strictEqual(META_REF.test(coreText(s)), want, `${k} ${uri}: the core's text`)
      }
      assert.strictEqual(F.featuresFor({ $ref: uri }).includes('metaschemas'), want, uri + ': featuresFor()')
      for (const [n, E] of Object.entries(ENTRIES)) {
        for (const s of [{ $ref: uri }, { $schema: DIALECTS['draft2020-12'], properties: { a: { $ref: uri } } }]) {
          assert.strictEqual(build(E.without, s) === 'meta', want, `${n}: ${JSON.stringify(s)} without the feature`)
        }
      }
    }
  }
  // Not a reference: the URI under another key, in a value, and in `$schema`.
  for (const s of [{ $id: YES[8] }, { $schema: YES[8], const: YES[8] }, { description: '"$ref":"' + YES[8] + '"' }, { $comment: YES[16], examples: [YES[16]] }]) {
    assert.strictEqual(META_REF.test(JSON.stringify(s)), false, JSON.stringify(s))
    assert.deepStrictEqual(F.featuresFor(s), [], JSON.stringify(s))
  }
  // A fragment of a draft-07 meta-schema resolves with the feature.
  for (const [n, E] of Object.entries(ENTRIES)) {
    const v = new E.with({ $ref: 'http://json-schema.org/draft-07/schema#/definitions/nonNegativeInteger' })
    assert.strictEqual(v.isValidObject(3), true, n + ': a definition of the draft-07 meta-schema')
    assert.strictEqual(v.isValidObject(-3), false, n + ': a definition of the draft-07 meta-schema')
  }

  // The feature registers each meta-schema under every spelling of its id,
  // and leaves an entry the caller registered under one of them.
  {
    const mine = { type: 'string' }
    const map = new Map([['https://json-schema.org/draft-06/schema', mine]])
    F.metaschemas.add(map)
    assert.strictEqual(map.get('https://json-schema.org/draft-06/schema'), mine)
    const d7 = F.metaschemas.map.get('http://json-schema.org/draft-07/schema#')
    for (const k of ['http://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft-07/schema', 'https://json-schema.org/draft-07/schema']) assert.strictEqual(map.get(k), d7, k)
    const d20 = F.metaschemas.map.get('https://json-schema.org/draft/2020-12/schema')
    for (const k of ['https://json-schema.org/draft/2020-12/schema', 'https://json-schema.org/draft/2020-12/schema#', 'http://json-schema.org/draft/2020-12/schema']) assert.strictEqual(map.get(k), d20, k)
    for (const [n, E] of Object.entries(ENTRIES)) {
      // A caller's own document under a meta-schema's id is the one read.
      const v = new E.with({ $ref: 'http://json-schema.org/draft-07/schema#' }, { schemas: [{ $id: 'http://json-schema.org/draft-07/schema#', type: 'string' }] })
      assert.strictEqual(v.isValidObject('x'), true, n + ': the caller\'s document under a meta-schema id')
      assert.strictEqual(v.isValidObject({}), false, n + ': the caller\'s document under a meta-schema id')
    }
  }

  // ---- the suite and SchemaStore ----
  const suite = path.join(ROOT, 'tests', 'suite')
  assert.ok(fs.existsSync(path.join(suite, 'tests')), 'the JSON Schema Test Suite is not checked out (tests/suite)')
  let hosted = 0; let hostedDocs = 0; let metaGroups = 0; let metaDocs = 0; let asked = 0; let yes = 0; let other = 0; let store = 0

  // One schema, directly and behind a $ref: the gates against the reading.
  function alike (schema, label) {
    const forms = [[schema, undefined]]
    if (isDoc(schema)) forms.push(behindRef(schema))
    for (const [s, o] of forms) {
      const want = refsMeta(s)
      const at = label + (o ? ' (behind a $ref)' : '')
      assert.strictEqual(META_REF.test(JSON.stringify(s)), want, at + ': META_REF on the text')
      assert.strictEqual(META_REF.test(coreText(s)), want, at + ': META_REF on the core\'s text')
      let named = null
      try { named = F.featuresFor(s, o && {}, o && o.schemas).includes('metaschemas') } catch {}
      if (named !== null) assert.strictEqual(named, want, at + ': featuresFor()')
      for (const [n, E] of Object.entries(ENTRIES)) {
        const b = build(E.without, s, o)
        // Refused for another reason before the question is asked (a schema
        // no entry takes): nothing to compare, and never where the reading
        // says no and featuresFor() answered.
        if (b === 'other') { other++; continue }
        assert.strictEqual(b === 'meta', want, `${at}: the ${n} entry without the feature`)
      }
      asked++
      if (want) yes++
    }
  }

  for (const file of jsonFiles(path.join(suite, 'tests'))) {
    const rel = path.relative(path.join(suite, 'tests'), file)
    const uri = DIALECTS[rel.split(path.sep)[0]]
    for (const g of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      const label = rel + ': ' + g.description
      const schema = uri !== undefined && isDoc(g.schema) && !('$schema' in g.schema) ? { $schema: uri, ...g.schema } : g.schema
      alike(schema, label)

      // A document of test.json-schema.org, reached by a $ref to its $id.
      if (isDoc(schema) && typeof schema.$id === 'string' && schema.$id.startsWith('https://test.json-schema.org/')) {
        const [root, o] = behindRef(schema)
        assert.ok(!F.featuresFor(root, {}, o.schemas).includes('metaschemas'), label + ': featuresFor() names no meta-schemas')
        for (const [n, E] of Object.entries(ENTRIES)) {
          const v = build(E.without, root, o); const w = build(E.with, root, o)
          assert.ok(typeof v === 'object' && typeof w === 'object', `${label}: the ${n} entry takes it (${v}, ${w})`)
          for (const t of g.tests) {
            assert.strictEqual(v.validate(structuredClone(t.data)).valid, t.valid, `${label}: ${t.description}: the ${n} entry`)
            assert.strictEqual(w.validate(structuredClone(t.data)).valid, t.valid, `${label}: ${t.description}: the ${n} entry with the feature`)
            assert.strictEqual(v.isValidObject(structuredClone(t.data)), t.valid, `${label}: ${t.description}: the ${n} entry's verdict`)
          }
        }
        hosted++; hostedDocs += g.tests.length
      }

      // A reference to a meta-schema: refused without the feature, answered
      // with it. Draft 3 is not a dialect ata reads; its group is held to the
      // refusal only.
      if (refsMeta(schema)) {
        for (const [n, E] of Object.entries(ENTRIES)) {
          assert.strictEqual(build(E.without, schema), 'meta', `${label}: the ${n} entry without the feature`)
          if (rel.startsWith('draft3')) continue
          const w = build(E.with, schema)
          assert.ok(typeof w === 'object', `${label}: the ${n} entry with the feature (${w})`)
          for (const t of g.tests) assert.strictEqual(w.validate(structuredClone(t.data)).valid, t.valid, `${label}: ${t.description}: the ${n} entry with the feature`)
        }
        metaGroups++; metaDocs += g.tests.length
      }
    }
  }
  for (const file of jsonFiles(path.join(suite, 'remotes'))) {
    let schema; try { schema = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { continue }
    alike(schema, 'remotes/' + path.relative(path.join(suite, 'remotes'), file))
  }
  const storeDir = path.join(process.env.ATA_SCHEMASTORE || path.join(ROOT, '..', 'schemastore'), 'src', 'schemas', 'json')
  const withStore = fs.existsSync(storeDir)
  if (withStore) {
    for (const f of fs.readdirSync(storeDir).filter((x) => x.endsWith('.json'))) {
      let schema; try { schema = JSON.parse(fs.readFileSync(path.join(storeDir, f), 'utf8')) } catch { continue }
      alike(schema, 'schemastore/' + f)
      store++
    }
  }

  assert.ok(hosted >= 25, hosted + ' suite documents on test.json-schema.org')
  assert.ok(metaGroups >= 11, metaGroups + ' suite groups reference a meta-schema')
  assert.ok(asked > 4000 && yes >= metaGroups, `${asked} schemas asked, ${yes} referencing a meta-schema`)
  console.log(`ok: ${YES.length} meta-schema URIs ask for the feature and ${NO.length} others do not; ${hosted} suite documents on test.json-schema.org (${hostedDocs} documents) taken without it on the core, browser and edge entries; ${metaGroups} suite groups that reference a meta-schema (${metaDocs} documents) refused without it and answered with it; ${asked} schemas, directly and behind a $ref, asked alike by the three entries, featuresFor() and the core's walk, ${yes} of them referencing a meta-schema, ${other} builds refused for another reason${withStore ? `; ${store} SchemaStore schemas among them` : '; SchemaStore not found, the suite only'}`)
})().catch((e) => { console.error(e); process.exit(1) })
