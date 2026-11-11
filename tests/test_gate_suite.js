'use strict'

// Every path that answers for a schema, held to the Validator on the same
// documents (scripts/gate.js): verdict, the error fields each path promises,
// their order, and the document afterwards, on the official suite's six
// dialects. `node scripts/gate.js --schemastore <dir>` adds a SchemaStore
// checkout.

const assert = require('node:assert')
const { run, summary, PATHS } = require('../scripts/gate.js')

run({}).then((r) => {
  const paths = Object.entries(r.stats.paths)
  assert.strictEqual(paths.length, Object.keys(PATHS).length, 'every path ran')
  for (const [name, s] of paths) assert.ok(s.taken > 500 && s.docs > 10000, `${name} took ${s.taken} schemas and ${s.docs} documents`)
  const bad = paths.reduce((n, [, s]) => n + s.diffs + s.threw, 0)
  assert.strictEqual(bad, 0, '\n' + summary(r))
  console.log(`test_gate_suite: ${r.stats.schemas} schemas, ${paths.length} paths, ${paths.reduce((n, [, s]) => n + s.docs, 0)} documents, 0 differences`)
}).catch((e) => { console.error(e); process.exit(1) })
