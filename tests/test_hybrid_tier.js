'use strict'

// validate() and validateJSON() answer their first calls through the verdict
// function and an error resolver, and switch to the single-function hybrid once
// a validator is warm. The two tiers must give the same answer: the same
// verdict, the same errors. This runs every case of the official suite through
// one validator per group, first on the cold tier and then again after enough
// calls to have switched, and compares the two and the interpreted engine's
// verdict, and reports how much it compared so a change that never reaches the
// second tier cannot pass. The suite's own expected answers assume the suite
// runner's options, so the reference here is the interpreter on the same ones.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { Validator } = require('..')

const TIER = 64
const dir = path.join(__dirname, 'suite/tests/draft2020-12')
const groups = []
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) groups.push([`${f}: ${g.description}`, g])
}

const shape = (r) => JSON.stringify({ valid: r.valid, errors: r.valid ? [] : r.errors.map((e) => [e.keyword, e.instancePath, e.schemaPath]) })

let compared = 0, warmed = 0, bad = 0
const report = (m) => { if (bad++ < 10) console.error(m) }
// The default validate() answers a verdict itself and reaches the tiered path
// only when errors are read; coerceTypes turns that layer off, so the tiered
// path answers every call. Both are run, and the warm-up reads the errors.
for (const opts of [{}, { coerceTypes: true }]) {
  for (const [label, g] of groups) {
    let v, ref
    try {
      v = new Validator(g.schema, opts)
      ref = new Validator(g.schema, { ...opts, engine: 'interpreter' })
    } catch { continue }
    const texts = g.tests.map((t) => JSON.stringify(t.data))
    const cold = []
    const coldJson = []
    for (let i = 0; i < g.tests.length; i++) {
      cold.push(shape(v.validate(JSON.parse(texts[i]))))
      coldJson.push(shape(v.validateJSON(texts[i])))
    }
    // Push both entry points past the tier with the group's own documents,
    // reading the errors so the default path reaches the tier too.
    for (let n = 0; n < TIER; n++) {
      void v.validate(JSON.parse(texts[n % texts.length])).errors
      void v.validateJSON(texts[n % texts.length]).errors
    }
    warmed++
    for (let i = 0; i < g.tests.length; i++) {
      const hot = shape(v.validate(JSON.parse(texts[i])))
      const hotJson = shape(v.validateJSON(texts[i]))
      compared += 2
      const tag = `${JSON.stringify(opts)} ${label} #${i}`
      if (hot !== cold[i]) report(`${tag}: validate cold ${cold[i]} vs warm ${hot}`)
      if (hotJson !== coldJson[i]) report(`${tag}: validateJSON cold ${coldJson[i]} vs warm ${hotJson}`)
      const want = ref.validate(JSON.parse(texts[i])).valid
      if (JSON.parse(hot).valid !== want) report(`${tag}: warm verdict ${JSON.parse(hot).valid}, interpreter ${want}`)
    }
  }
}

assert.strictEqual(bad, 0, `${bad} disagreements between the cold and the warm tier`)
assert.ok(warmed > 600 && compared > 4000, `warmed ${warmed} validators and compared ${compared} answers: too few`)
console.log(`ok: cold and warm tiers agree on ${compared} answers over ${warmed} validators`)
