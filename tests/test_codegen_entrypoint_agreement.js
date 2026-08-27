'use strict'

// Every code generation entry point must either decline a schema or be right
// about it. Nothing in between.
//
// The compiler has four entry points and each builds its own context and runs
// its own safety bails. Three times now a bail present in one has been missing
// from another, and the failure mode is always the same: the generator emits no
// code for something it cannot represent, the empty program is returned as
// always-valid, and every constraint behind it disappears without an error.
//
// Prose in CLAUDE.md asking the next person to check the other entry points is
// not enforcement. This is. It drives the whole official suite through each
// entry point directly, rather than through `Validator`, so an entry point
// cannot hide behind whichever one the router happened to pick. The interpreted
// The comparison is between the entry points themselves rather than against the
// suite's expected values. Two reasons. The Validator hands these paths options
// (`assertFormat`, `useDefaults`) that a bare call does not, so measuring them
// against the suite would mostly measure that configuration gap. And the defect
// this guards against is divergence: whenever one path has a bail another lacks,
// they answer differently on the same schema. Any two that both agree to compile
// a schema must agree about every instance of it.

const fs = require('fs')
const path = require('path')
const {
  compileToJS,
  compileToJSCodegen,
  compileToJSCombined,
  compileToJSCodegenWithErrors,
} = require('../lib/js-compiler.js')

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  v1: 'https://json-schema.org/v1',
}

const VALID_RESULT = { valid: true, errors: [] }

// The suite serves its remote schemas from http://localhost:1234/<relative path>.
function loadRemotes() {
  const registry = new Map()
  ;(function collect(dir, prefix) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) collect(full, prefix + entry.name + '/')
      else if (entry.name.endsWith('.json')) {
        try {
          registry.set(
            'http://localhost:1234/' + prefix + entry.name,
            JSON.parse(fs.readFileSync(full, 'utf8')),
          )
        } catch {}
      }
    }
  })(path.join(__dirname, 'suite/remotes'), '')
  return registry
}

// Each entry point returns a different shape. Normalise to a boolean verdict,
// or null when the call declined or could not answer on its own.
const ENTRY_POINTS = [
  {
    name: 'compileToJS',
    build: (schema, map) => compileToJS(schema, null, map),
    verdict: (fn, data) => {
      const r = fn(data)
      return typeof r === 'boolean' ? r : null
    },
  },
  {
    name: 'compileToJSCodegen',
    build: (schema, map) => compileToJSCodegen(schema, map),
    verdict: (fn, data) => {
      const r = fn(data)
      return typeof r === 'boolean' ? r : null
    },
  },
  {
    name: 'compileToJSCombined',
    build: (schema, map) => compileToJSCombined(schema, VALID_RESULT, map),
    verdict: (fn, data) => {
      const r = fn(data)
      return r && typeof r === 'object' && typeof r.valid === 'boolean' ? r.valid : null
    },
  },
  {
    name: 'compileToJSCodegenWithErrors',
    build: (schema, map) => compileToJSCodegenWithErrors(schema, map),
    verdict: (fn, data) => {
      const r = fn(data, true)
      return r && typeof r === 'object' && typeof r.valid === 'boolean' ? r.valid : null
    },
  },
  {
    // Not an entry point of its own but a fifth program: the boolean's source
    // with its top-level returns rewritten. It is what Validator installs as
    // validate() for most schemas, so it is the program most users actually
    // run, and it went unguarded for five months while the four above were
    // compared. A rewrite that reaches into a nested closure changes that
    // closure's result type and the verdict with it.
    name: 'hybrid (rewritten compileToJSCodegen)',
    build: (schema, map) => {
      const bool = compileToJSCodegen(schema, map)
      if (typeof bool !== 'function' || typeof bool._hybridFactory !== 'function') return null
      const errFn = compileToJSCodegenWithErrors(schema, map)
      if (typeof errFn !== 'function') return null
      return bool._hybridFactory(VALID_RESULT, (d) => errFn(d, true))
    },
    verdict: (fn, data) => {
      const r = fn(data)
      return r && typeof r === 'object' && typeof r.valid === 'boolean' ? r.valid : null
    },
  },
]

const remotes = loadRemotes()
const disagreements = []
let compiled = 0
let declined = 0
let checked = 0

for (const [dialect, uri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite/tests', dialect)
  if (!fs.existsSync(dir)) continue

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const groups = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))

    for (const group of groups) {
      if (typeof group.schema !== 'object' || group.schema === null) continue

      // The suite states the dialect by directory rather than in every schema.
      const schema = '$schema' in group.schema ? group.schema : { ...group.schema, $schema: uri }

      const map = new Map(remotes)
      for (const id in group.registry || {}) map.set(id, group.registry[id])

      // Build every entry point that agrees to take this schema.
      const built = []
      for (const entry of ENTRY_POINTS) {
        let fn
        try {
          fn = entry.build(schema, map)
        } catch {
          declined++
          continue // throwing is a loud decline, which is allowed
        }
        if (typeof fn !== 'function') {
          declined++
          continue // declining is always allowed
        }
        compiled++
        built.push({ name: entry.name, verdict: (d) => entry.verdict(fn, d) })
      }
      if (built.length < 2) continue

      for (const test of group.tests || []) {
        const answers = []
        for (const b of built) {
          let v
          try {
            v = b.verdict(test.data)
          } catch {
            continue // throwing is loud, not silent
          }
          if (v === null) continue // deferred to a later stage, not an answer
          answers.push({ name: b.name, valid: v })
        }
        if (answers.length < 2) continue
        checked++

        const first = answers[0].valid
        const split = answers.some((a) => a.valid !== first)
        if (split) {
          disagreements.push({
            where: `${dialect}/${file} :: ${group.description} :: ${test.description}`,
            answers: answers.map((a) => `${a.name}=${a.valid}`).join('  '),
            expected: test.valid,
            schema: JSON.stringify(schema).slice(0, 150),
          })
        }
      }
    }
  }
}

console.log('\ncodegen entry point agreement\n')
console.log(`  ${compiled} compiles accepted, ${declined} declined`)
console.log(`  ${checked} instances where at least two entry points both answered`)

if (disagreements.length > 0) {
  console.log(`\n  ${disagreements.length} disagreements:\n`)
  for (const d of disagreements.slice(0, 12)) {
    console.log(`    ${d.where}`)
    console.log(`      ${d.answers}   (suite expects ${d.expected})`)
    console.log(`      ${d.schema}`)
  }
  if (disagreements.length > 12) console.log(`    ... and ${disagreements.length - 12} more`)
  console.log(
    '\n  An entry point may decline a schema. Two that both compile it may not disagree about it.',
  )
  process.exit(1)
}

if (checked === 0) {
  console.error('\n  compared nothing; the suite submodule is probably not checked out')
  process.exit(1)
}

console.log('\nok: no two entry points disagree on a schema they both compiled\n')
