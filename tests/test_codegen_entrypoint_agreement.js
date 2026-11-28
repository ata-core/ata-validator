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

const {
  compileToJS,
  compileToJSCodegen,
  compileToJSCombined,
  compileToJSCodegenWithErrors,
} = require('../lib/js-compiler.js')

const suite = require('./suite-loader')
const DIALECTS = ['draft2020-12', 'draft7', 'v1']

const VALID_RESULT = { valid: true, errors: [] }

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

const disagreements = []
let compiled = 0
let declined = 0
let checked = 0

for (const dialect of suite.HAVE_SUITE ? DIALECTS : []) {
  for (const { file, cases } of suite.files(dialect)) {
    for (const group of cases) {
      if (typeof group.schema !== 'object' || group.schema === null) continue

      // The loader has put the dialect in, and each case has its own external
      // documents: the same retrieval URI can mean different documents in
      // different cases.
      const schema = group.schema
      const map = suite.registryMap(group)

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

// References inside a registered document, reached through another one. Every
// entry point once agreed here, on true: the reference that cannot be resolved
// emitted no check in each of them that compiled, so agreement between them
// showed nothing. These are held to the interpreted engine's answer as well.
{
  const { Validator } = require('..')
  const doc = (ref) => ({ $id: 'https://example.com/agree/a.json', type: 'object', properties: { p: { $ref: ref } } })
  const groups = [
    ['unresolved relative pointer', doc('missing.json#/definitions/x'), []],
    ['unresolved absolute pointer', doc('https://example.com/agree/missing.json#/definitions/x'), []],
    ['pointer missing in a registered target', doc('missing.json#/definitions/zz'), [{ $id: 'https://example.com/agree/missing.json', definitions: { x: { type: 'string' } } }]],
    ['file name matching another host', doc('b.json'), [{ $id: 'https://other.org/agree/b.json', type: 'string' }]],
    ['mdxlintrc shape', { $schema: 'http://json-schema.org/draft-07/schema#', $id: 'https://example.com/agree/mdxlintrc.json', properties: { plugins: { $ref: 'remarkrc.json#/properties/plugins' } } }, []],
  ]
  // A fragment-only reference two documents from the root, which has a
  // definition of that name and b.json does not.
  groups.push(['local pointer two documents away', { $id: 'https://example.com/agree/a.json', properties: { p: { $ref: 'https://example.com/agree/b.json' } } },
    [{ $id: 'https://example.com/agree/b.json', properties: { r: { $ref: '#/definitions/nope' } } }],
    { definitions: { nope: { type: 'number' } }, properties: { q: { $ref: 'https://example.com/agree/a.json' } } }])
  for (const [description, target, extra, root] of groups) {
    const schema = root || { $ref: target.$id }
    const map = new Map([[target.$id, target], ...extra.map((d) => [d.$id, d])])
    const interp = new Validator(schema, { schemas: [target, ...extra], engine: 'interpreter' })
    const docs = [{ p: 1 }, { p: 's' }, { plugins: 42 }, {}, { q: { p: { r: 1 } } }]
    for (const entry of ENTRY_POINTS) {
      let fn
      try { fn = entry.build(schema, map) } catch { declined++; continue }
      if (typeof fn !== 'function') { declined++; continue }
      compiled++
      for (const data of docs) {
        let v
        try { v = entry.verdict(fn, data) } catch { continue }
        if (v === null) continue
        checked++
        const expected = interp.validate(data).valid
        if (v !== expected) {
          disagreements.push({
            where: `registered documents :: ${description} :: ${JSON.stringify(data)}`,
            answers: `${entry.name}=${v}  interpreter=${expected}`,
            expected,
            schema: JSON.stringify(target).slice(0, 150),
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
