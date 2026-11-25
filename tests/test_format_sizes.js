'use strict'

// featuresFor() names the per-name format features or the formats and uri
// groups for a schema's set of formats, by the sizes scripts/gen-format-sizes.js
// measured (features/format-sizes.mjs). Here real builds hold the choice: for
// every single name, for growing sets and for a spread of mixed ones, the
// page featuresFor() picks is within TOLERANCE bytes of the least of every way
// (each family of formats by its names or by its group),
// and a page with the groups is never larger than the groups were at 4614fb1
// (FORMATS_AND_URI_4614FB1, the floor included). The table must also name
// every per-name feature and every shared part there is.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { gz, page, SETS } = require('../scripts/gen-format-sizes.js')
const { NAMES, featureOf } = require('../lib/groups.js')

// The estimate is a fit: on the sets here it has missed the smaller page by up
// to 49 bytes, never by enough to cross the groups at 4614fb1.
const TOLERANCE = 64
// The core with the formats and uri groups at 4614fb1, gzip -9 by the same
// build (18,339 + 4,079 by the lemire-core-1121 method; this build differs
// from it by no code splitting).
const FORMATS_AND_URI_4614FB1 = 22418

;(async () => {
  const { featuresFor } = await import('../features/index.mjs')
  const S = await import('../features/format-sizes.mjs')
  assert.deepStrictEqual(Object.keys(S.OWN).sort(), NAMES.map(featureOf).sort(), 'every per-name feature is measured')
  assert.deepStrictEqual(Object.keys(S.PART).sort(), fs.readdirSync(path.join(__dirname, '../lib/fmt')).map((f) => f.replace(/\.js$/, '')).sort(), 'every shared part is measured')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-format-sizes-test-'))
  const cost = new Map()
  const build = async (names) => { const k = names.slice().sort().join(','); if (!cost.has(k)) cost.set(k, (await gz(page(names.map((n) => [n, n + '.js'])), dir)).gz); return cost.get(k) }
  // The fit's own sets, and mixes it was not fitted on.
  const sets = SETS()
  for (let i = 0; i < 16; i++) sets.push(NAMES.filter((_, j) => ((j * 5 + i * 11) % 17) < 4 + (i % 10)))
  let groups = 0; let worst = 0
  try {
    for (const set of sets) {
      if (set.length === 0) continue
      const schema = { allOf: set.map((format) => ({ format })) }
      const picked = featuresFor(schema).filter((n) => n !== 'branchCollapse')
      // Every way to register the set: each family by its names or its group.
      const URI = ['uri', 'uri-reference', 'iri', 'iri-reference']
      const fam = { f: set.filter((n) => !URI.includes(n)).map(featureOf), u: set.filter((n) => URI.includes(n)).map(featureOf) }
      const ways = []
      for (const gf of fam.f.length ? [false, true] : [false]) for (const gu of fam.u.length ? [false, true] : [false]) ways.push((gf ? ['formats'] : fam.f).concat(gu ? ['uri'] : fam.u))
      const costs = []; for (const w of ways) costs.push(await build(w))
      const per = costs[0]; const least = Math.min(...costs)
      const got = await build(picked)
      assert.ok(ways.some((w) => w.slice().sort().join() === picked.slice().sort().join()), set + ': ' + picked)
      assert.ok(got <= least + TOLERANCE, `${set}: picked ${picked} at ${got}, the least ${least}`)
      if (picked.includes('formats') || picked.includes('uri')) { groups++; assert.ok(got <= FORMATS_AND_URI_4614FB1, `${set}: groups at ${got}`) }
      worst = Math.max(worst, got - least); void per
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  assert.ok(groups > 0, 'some sets are named as groups')
  console.log(`ok: ${sets.length} format sets, featuresFor() picks the smaller page within ${worst} bytes (tolerance ${TOLERANCE}); ${groups} as groups, none over the groups at 4614fb1`)
})().catch((e) => { console.error(e); process.exit(1) })
