'use strict'

// Building the data position map must not cost a large multiple of parsing the
// same text.
//
// The map is built when a document fails validation and the caller wants line
// and column for the errors. It used to walk the document recording an entry
// for every node: a pointer string rebuilt with path.concat + map + join per
// node, two binary searches and an object allocation per node, and a
// JSON.parse(text.slice(...)) for every string value whose result was then
// thrown away. On a 132 KB config that came to 19x the cost of JSON.parse on
// the same text, and it was about three quarters of the whole validateJSON
// call on the invalid path.
//
// The budget is a ratio, not a time, so machine speed does not matter. The old
// regime measured 17x to 19x across document sizes, the rewritten one 5x to 8x
// (7.0 alone, 7.8 under the load of the full suite), and the gate sits between
// them with margin both ways.

const { buildDataPositionMap } = require('../lib/data-positions')

function makeConfig (nSections, nEntries) {
  const cfg = { version: '1.0.0', name: 'browsing', sections: {} }
  for (let s = 0; s < nSections; s++) {
    const entries = []
    for (let e = 0; e < nEntries; e++) {
      entries.push({
        id: 'entry-' + s + '-' + e,
        enabled: e % 3 !== 0,
        weight: e * 1.5,
        tags: ['alpha', 'beta', 'gamma'],
        nested: { timeout: 5000, retries: 3, url: 'https://example.com/s' + s + '/e' + e },
      })
    }
    cfg.sections['section_' + s] = { title: 'Section ' + s, entries }
  }
  return cfg
}

const raw = JSON.stringify(makeConfig(20, 20), null, 2)

// A wrong map would make any ratio meaningless.
const map = buildDataPositionMap(raw)
if (map['/version'].line !== 2) {
  console.error('FAIL position map cost: map is wrong before measuring')
  process.exit(1)
}

for (let i = 0; i < 10; i++) { buildDataPositionMap(raw); JSON.parse(raw) }
const N = 10
const mapped = []
const parsed = []
for (let r = 0; r < 9; r++) {
  let t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) buildDataPositionMap(raw)
  mapped.push(Number(process.hrtime.bigint() - t))
  t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) JSON.parse(raw)
  parsed.push(Number(process.hrtime.bigint() - t))
}
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
const ratio = median(mapped) / median(parsed)

const BUDGET = 12
if (ratio > BUDGET) {
  console.error(`FAIL position map cost: map/parse ratio ${ratio.toFixed(1)} exceeds ${BUDGET}, the per-node work is back`)
  process.exit(1)
}
console.log(`position map cost: map/parse ratio ${ratio.toFixed(1)} (budget ${BUDGET})`)
