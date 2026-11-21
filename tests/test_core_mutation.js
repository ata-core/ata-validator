'use strict'

// The verdict core (lib/core/verdict.js) under schema mutation. For every
// group of the official suite, six dialects, with a document the small engine
// accepts: each schema is changed one keyword at a time, in every subschema
// (tests/_schema_mutations.js), and every document whose verdict the change
// flips for the small engine must flip the same way for the core. A core
// that ignores a keyword where it sits (behind a $ref, in a branch, beside
// unevaluated*) passes the unchanged suite and fails here.
//
// The schema and arguments are what lib/validator-small.js hands its engine.
// A schema the core declines is counted, never passed. Verdicts only: the
// core gives no errors.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const small = require('../lib/validator-small.js')
const { createSmall } = require('../lib/engine-small.js')
const C = require('../lib/core/verdict.js')
C._parts(() => require('../lib/core/verdict-more.js'))
const { run, CONTEXTS } = require('./_schema_mutations.js')
// Every schema-decided group (lib/groups.js), as the full 2.0 entries register them.
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)
small.Validator.use(require('../lib/features/error-messages.js').errorMessages, require('../lib/features/metaschemas.js').metaschemas)

// What validator-small hands its engine for a schema, or null where it
// refuses the schema or the small engine does not take it.
let last = null
class Capture extends small.Validator {}
Capture.prototype.core = (schema, args) => {
  if (args === undefined) return JSON.stringify(schema) || ''
  last = { schema, args }
  return createSmall(schema, args)
}
function capture (schema) {
  last = null
  try { new Capture(schema)._build() } catch { return null }
  return last
}

function build (schema) {
  const cap = capture(schema)
  if (cap === null) return null
  const oracle = createSmall(cap.schema, cap.args)
  if (oracle === null) return null
  let v
  try { v = C.createVerdict(cap.schema, cap.args) } catch (e) { v = () => { throw e } }
  return { oracle: (d) => oracle.isValid(d), candidate: v === null ? null : (d) => v(d) }
}

const DIALECTS = { 'draft2020-12': 'https://json-schema.org/draft/2020-12/schema', 'draft2019-09': 'https://json-schema.org/draft/2019-09/schema', draft7: 'http://json-schema.org/draft-07/schema#', draft6: 'http://json-schema.org/draft-06/schema#', draft4: 'http://json-schema.org/draft-04/schema#', v1: 'https://json-schema.org/v1' }
function * groups () {
  const S = path.join(__dirname, 'suite/tests')
  for (const dialect of Object.keys(DIALECTS)) {
    for (const sub of ['', 'optional', 'optional/format']) {
      const dir = path.join(S, dialect, sub)
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
        for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
          if (JSON.stringify(g.schema).includes('localhost:1234')) continue
          const schema = g.schema !== null && typeof g.schema === 'object' && !Array.isArray(g.schema) && !('$schema' in g.schema) ? { $schema: DIALECTS[dialect], ...g.schema } : g.schema
          yield { label: `${dialect}/${sub ? sub + '/' : ''}${f}: ${g.description}`, schema, docs: g.tests.map((t) => t.data) }
        }
      }
    }
  }
}

const st = run(groups(), build)
const show = (d) => { try { return JSON.stringify(d).slice(0, 100) } catch { return String(d) } }
for (const f of st.failures.slice(0, 20)) console.log(`  ${f.label} | ${f.pointer} ${f.what} | [${f.contexts.join(', ')}] | ${show(f.doc)}: small engine ${f.oracle}, core ${f.candidate}`)
assert.strictEqual(st.failures.length, 0, `${st.failures.length} mutated verdicts differ`)
// Enough of the suite reached the core that a silent acceptance would show:
// these floors are well under what the run reaches today (see the line
// printed below), and a core that declines more than it did fails them.
assert.ok(st.groups > 1500 && st.checked > 9000, `${st.groups} groups, ${st.checked} flips checked`)
for (const c of ['top level', 'through $ref', 'in allOf', 'in anyOf', 'in oneOf', 'in not', 'in if/then/else']) assert.ok(st.contexts[c].checked > 50, `${c}: ${st.contexts[c].checked} flips checked`)
const per = CONTEXTS.map((c) => `${c} ${st.contexts[c].checked}/${st.contexts[c].flips}`).join(', ')
console.log(`test_core_mutation: ok, ${st.groups} groups, ${st.mutants} mutants, ${st.checked} of ${st.flips} flipped verdicts checked (${st.declinedDocs} on schemas the core declines); by context, checked/flipped: ${per}`)
