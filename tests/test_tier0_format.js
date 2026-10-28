'use strict'
// Tier 0, the shared verdict for simple object schemas, checks `format` on a
// string property with the table the interpreted engine reads
// (formats.formatChecks) or the caller's own function. Held here to the same
// verdicts as the interpreted engine and the generated code, on every case of
// the official suite's format tests in every dialect, with each value as a
// property of an object (tier 0 takes objects of primitives).
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { Validator } = require('..')
const { classify } = require('../lib/shape-classifier')
const { buildTier0Plan, tier0Validate } = require('../lib/tier0')

let compared = 0
const diffs = []
for (const dialect of ['draft2020-12', 'draft2019-09', 'draft7', 'draft6', 'draft4']) {
  const dir = path.join(__dirname, 'suite/tests', dialect, 'optional/format')
  if (!fs.existsSync(dir)) continue
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      const format = group.schema && group.schema.format
      if (typeof format !== 'string') continue
      for (const required of [false, true]) {
        const schema = { type: 'object', properties: { x: { type: 'string', format } }, ...(required ? { required: ['x'] } : {}) }
        assert.strictEqual(classify(schema).tier, 0, `${format} should take tier 0`)
        const plan = buildTier0Plan(schema)
        const interpreted = new Validator(schema, { engine: 'interpreter' })
        const generated = new Validator(schema)
        for (const t of group.tests) {
          const doc = t.data === undefined ? {} : { x: t.data }
          const a = tier0Validate(plan, doc)
          const b = interpreted.isValidObject(doc)
          const c = generated.validate(doc).valid
          compared++
          if (a !== b || a !== c) diffs.push(`${dialect}/${file} ${format} ${JSON.stringify(t.data)}: tier0 ${a}, interpreter ${b}, generated ${c}`)
        }
      }
    }
  }
}
if (diffs.length) { console.error(diffs.slice(0, 10).join('\n')); assert.fail(`${diffs.length} verdicts differ`) }
assert.ok(compared > 1000, `only ${compared} cases`)

// A caller's own format wins over the built-in one of the same name, as in
// the interpreted engine; an unknown format is an annotation.
const own = { formats: { email: (s) => s === 'mine', even: (s) => s.length % 2 === 0 } }
for (const [format, doc, want] of [['email', { x: 'mine' }, true], ['email', { x: 'a@b.co' }, false], ['even', { x: 'ab' }, true], ['even', { x: 'abc' }, false], ['no-such-format', { x: 'anything' }, true]]) {
  const schema = { type: 'object', properties: { x: { type: 'string', format } } }
  assert.strictEqual(tier0Validate(buildTier0Plan(schema, own.formats), doc), want, `${format} ${JSON.stringify(doc)}`)
  assert.strictEqual(new Validator(schema, own).isValidObject(doc), want, `first call, ${format}`)
  assert.strictEqual(new Validator(schema, { ...own, engine: 'interpreter' }).isValidObject(doc), want, `interpreter, ${format}`)
}
// A format on another type stays off tier 0.
assert.strictEqual(classify({ type: 'object', properties: { n: { type: 'integer', format: 'int32' } } }).tier, 2)
console.log(`ok: tier 0 answers format as the interpreted engine and the generated code do on ${compared} cases`)
