'use strict'

// Reading `.errors` must never throw.
//
// The combined generator accumulates errors in a variable named `_e`. The emitted
// source for the `uri-template` format declared its own `const _e` for the index
// of a closing brace, which shadowed the accumulator inside that block, so
// `(_e||(_e=[])).push(...)` ran against a number:
//
//   new Validator({ format: 'uri-template' })
//     .validate('http://example.com/dictionary/{term:1}/{term').errors
//   TypeError: (_e || _e).push is not a function
//
// The verdict was right and the suite passed, because the suite reads verdicts.
// The throw was reachable from any caller that read the errors, and it was in
// 1.27.1 and 1.29.0 as shipped. It was found by removing an unrelated laziness
// layer, which made the error path run eagerly and surfaced it immediately: the
// layer had been hiding it.
//
// Three checks, because the interesting thing is the class, not the one format:
// the specific case, a static check that no emitted source declares the
// accumulator's name, and a sweep of the official suite reading every rejection's
// errors.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { Validator } = require('..')

// --- the case ---------------------------------------------------------------
{
  const v = new Validator({ format: 'uri-template' })
  const bad = 'http://example.com/dictionary/{term:1}/{term'
  const r = v.validate(bad)
  assert.strictEqual(r.valid, false, 'an unclosed expression is not a uri-template')
  const errors = r.errors // this is what threw
  assert.strictEqual(errors.length, 1, `one error, got ${JSON.stringify(errors)}`)
  assert.strictEqual(errors[0].keyword, 'format')
  assert.strictEqual(v.validate('http://example.com/dictionary/{term:1}/{term}').valid, true, 'a closed one is')
  console.log('ok: uri-template reports its error instead of throwing')
}

// --- the class, statically --------------------------------------------------
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'formats.js'), 'utf8')
  // Only the emitted halves matter: those strings are spliced into a function
  // that already has `_e` in scope. A backtick line declaring it is the bug.
  const offenders = []
  for (const line of src.split('\n')) {
    if (!line.includes('`')) continue
    if (/(const|let|var)\s+_e\s*=/.test(line)) offenders.push(line.trim().slice(0, 90))
  }
  assert.deepStrictEqual(offenders, [], 'no emitted format source may declare the error accumulator `_e`')
  console.log('ok: no emitted format source shadows the error accumulator')
}

// --- the class, behaviourally, over the official suite ----------------------
{
  const root = path.join(__dirname, 'suite', 'tests')
  if (!fs.existsSync(root)) {
    console.log('skip: suite submodule not checked out')
  } else {
    let schemas = 0, cases = 0
    const crashes = []
    for (const dialect of ['draft2020-12', 'draft7']) {
      const dir = path.join(root, dialect)
      if (!fs.existsSync(dir)) continue
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        let groups
        try { groups = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) } catch { continue }
        for (const group of groups) {
          let v
          try { v = new Validator(group.schema) } catch { continue }
          schemas++
          for (const t of group.tests) {
            cases++
            let r
            try { r = v.validate(t.data) } catch { continue } // a throwing validate is another test's business
            if (r.valid) continue
            try {
              void r.errors.length
            } catch (e) {
              crashes.push(`${dialect}/${file}/${group.description}/${t.description}: ${e.message}`)
            }
          }
        }
      }
    }
    if (crashes.length) {
      console.error(`FAIL error accumulator collision: reading .errors threw on ${crashes.length} suite cases`)
      for (const c of crashes.slice(0, 5)) console.error('  ' + c)
      process.exit(1)
    }
    console.log(`ok: .errors read without throwing on every rejection in ${schemas} suite schemas (${cases} cases)`)
  }
}
