'use strict'

// joinFeatures() (ata-validator/features): the features for a page with
// several validators, from featuresFor() of each. On pairs of the official
// suite's schemas that need formats, in every dialect:
// - for one schema, joinFeatures(featuresFor(s)) is featuresFor(s);
// - the joined list covers every check of both: every other feature, and
//   every format either list registers (by name or through its group), and a
//   core given exactly the joined list takes both schemas;
// - a page registering the joined list is never larger than one registering
//   both lists as they are (real builds, gzip -9).
// Pairs of larger format sets, which take the groups, are held to the same
// within the estimate's tolerance (tests/test_format_sizes.js).

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { gz, page } = require('../scripts/gen-format-sizes.js')
const { NAMES, featureOf } = require('../lib/groups.js')

const TOLERANCE = 64
const URI = new Set(['uri', 'uri-reference', 'iri', 'iri-reference'])
const FMT = new Set(NAMES.map(featureOf))
const FRESH = ['validator-small.js', 'groups.js', 'engine-small.js'].map((f) => path.join(__dirname, '..', 'lib', f))

;(async () => {
  const { featuresFor, joinFeatures } = await import('../features/index.mjs')
  const F = await import(pathToFileURL(path.join(__dirname, '..', 'index.v2.features.mjs')).href)
  const coreWith = (names) => {
    for (const f of FRESH) delete require.cache[f]
    const V = require(FRESH[0]).Validator
    if (names.length) V.use(...names.map((n) => F[n]))
    for (const f of FRESH) delete require.cache[f]
    return V
  }
  // The format names a list registers.
  const checks = (list) => {
    const out = new Set()
    for (const n of list) {
      if (n === 'formats') for (const x of NAMES) { if (!URI.has(x)) out.add(x) }
      else if (n === 'uri') for (const x of URI) out.add(x)
      else if (FMT.has(n)) out.add(NAMES.find((x) => featureOf(x) === n))
    }
    return out
  }
  const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', draft7: 'http://json-schema.org/draft-07/schema#', 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft4: 'http://json-schema.org/draft-04/schema#' }
  const cases = []
  for (const [dialect, uri] of Object.entries(DIALECTS)) {
    for (const sub of ['', 'optional/format']) {
      const dir = path.join(__dirname, 'suite/tests', dialect, sub)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
          if (JSON.stringify(g.schema).includes('localhost:1234')) continue
          const schema = g.schema !== null && typeof g.schema === 'object' && !('$schema' in g.schema) ? { $schema: uri, ...g.schema } : g.schema
          let names
          try { names = featuresFor(schema) } catch { continue }
          assert.deepStrictEqual(joinFeatures(names), names, `${dialect}/${f}: joinFeatures(featuresFor(s)) is featuresFor(s)`)
          if (names.some((n) => FMT.has(n) || n === 'formats' || n === 'uri')) cases.push({ schema, names, data: g.tests[0].data })
        }
      }
    }
  }
  assert.ok(cases.length > 60, cases.length + ' schemas with formats')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-join-features-test-'))
  const cost = new Map()
  const build = async (names) => { const k = [...new Set(names)].sort().join(','); if (!cost.has(k)) cost.set(k, (await gz(page([...new Set(names)].filter((n) => FMT.has(n) || n === 'formats' || n === 'uri').map((n) => [n, n + '.js'])), dir)).gz); return cost.get(k) }
  let pairs = 0; let smaller = 0
  try {
    for (let i = 0; i < cases.length; i++) {
      for (const j of [i + 1, i + 7, i + 31]) {
        if (j >= cases.length) continue
        const a = cases[i]; const b = cases[j]
        const joined = joinFeatures(a.names, b.names)
        for (const n of [...a.names, ...b.names]) if (!FMT.has(n) && n !== 'formats' && n !== 'uri') assert.ok(joined.includes(n), `${n} kept: ${joined}`)
        const need = new Set([...checks(a.names), ...checks(b.names)]); const got = checks(joined)
        for (const x of need) assert.ok(got.has(x), `${x} covered by ${joined}`)
        const V = coreWith(joined)
        for (const c of [a, b]) new V(c.schema).validate(structuredClone(c.data))
        const together = await build(a.names.concat(b.names)); const mine = await build(joined)
        assert.ok(mine <= together, `${a.names} + ${b.names}: joined ${joined} at ${mine}, both lists at ${together}`)
        if (mine < together) smaller++
        pairs++
      }
    }
    // Larger sets, where groups come in: never larger than both lists beyond
    // the estimate's tolerance, and never one family twice.
    const sets = []
    for (let k = 3; k <= NAMES.length; k += 2) sets.push(NAMES.slice(0, k), NAMES.slice(-k))
    for (let i = 0; i < sets.length; i++) {
      for (const j of [i + 1, i + 5]) {
        if (j >= sets.length) continue
        const a = featuresFor({ allOf: sets[i].map((format) => ({ format })) })
        const b = featuresFor({ allOf: sets[j].map((format) => ({ format })) })
        const joined = joinFeatures(a, b)
        const need = new Set([...checks(a), ...checks(b)]); const got = checks(joined)
        for (const x of need) assert.ok(got.has(x), `${x} covered by ${joined}`)
        if (joined.includes('formats')) assert.ok(!joined.some((n) => FMT.has(n) && !URI.has(NAMES.find((x) => featureOf(x) === n))), 'formats and its names: ' + joined)
        if (joined.includes('uri')) assert.ok(!joined.some((n) => FMT.has(n) && URI.has(NAMES.find((x) => featureOf(x) === n))), 'uri and its names: ' + joined)
        const together = await build(a.concat(b)); const mine = await build(joined)
        assert.ok(mine <= together + TOLERANCE, `${a} + ${b}: joined ${joined} at ${mine}, both lists at ${together}`)
        if (mine < together) smaller++
        pairs++
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  console.log(`ok: joinFeatures() on ${pairs} pairs covers both and is never larger than both lists (${smaller} smaller); featuresFor() is its own join on every suite schema`)
})().catch((e) => { console.error(e); process.exit(1) })
