'use strict'

// The scan exists so normalization can be skipped. Skipping it wrongly hands an
// un-normalized schema to every engine, and nothing errors: a draft-07 `$ref`
// keeps siblings it should have dropped, a `nullable` field never becomes a
// null-accepting type, and the answer is quietly wrong. So the property that
// matters is not "the scan is accurate", it is:
//
//     the scan says no work  =>  normalizing really would change nothing
//
// The other direction is allowed to be wrong. A scan that claims work where
// there is none costs one clone and nothing else. This asserts the safe
// direction over every schema in the suite, and asserts the unsafe direction
// is genuinely unsafe by breaking the scan on purpose.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { normalizeDraft7, normalizeNullable } = require('../lib/draft7')
const { Validator } = require('../index.js')
const { needsNormalization, scan } = require('../lib/schema-scan')

let passed = 0
function check(name, fn) { fn(); console.log(`  PASS  ${name}`); passed++ }

// Ground truth: what `_normalizeCallerSchema` does today, run for its answer
// rather than its result.
function reallyChanges(schema, isDraft7) {
  const before = JSON.stringify(schema)
  const copy = JSON.parse(before)
  if (isDraft7) normalizeDraft7(copy, true)
  normalizeNullable(copy)
  return JSON.stringify(copy) !== before
}

function everySuiteSchema() {
  const root = path.join(__dirname, 'suite')
  const out = []
  const collect = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) collect(full)
      else if (e.name.endsWith('.json')) {
        let parsed
        try { parsed = JSON.parse(fs.readFileSync(full, 'utf8')) } catch { continue }
        if (Array.isArray(parsed)) {
          for (const c of parsed) if (c && c.schema !== undefined) out.push(c.schema)
        } else if (parsed && typeof parsed === 'object') {
          out.push(parsed)      // the remotes are schemas in their own right
        }
      }
    }
  }
  collect(path.join(root, 'tests'))
  collect(path.join(root, 'remotes'))
  return out
}

const SUITE = everySuiteSchema()

check(`the suite is actually loaded (${SUITE.length} schemas)`, () => {
  assert.ok(SUITE.length > 1500, `only found ${SUITE.length}`)
})

for (const asDraft7 of [false, true]) {
  check(`no schema in the suite is skipped when it needed work (draft7=${asDraft7})`, () => {
    const missed = []
    for (const schema of SUITE) {
      if (typeof schema !== 'object' || schema === null) continue
      if (needsNormalization(schema, asDraft7)) continue      // scan says work, fine
      if (reallyChanges(schema, asDraft7)) missed.push(schema) // scan said no, but it does
    }
    assert.deepStrictEqual(
      missed.map((s) => JSON.stringify(s).slice(0, 120)),
      [],
      `${missed.length} schemas would be handed to the engines un-normalized`,
    )
  })
}

check('how often the scan is merely pessimistic, for the record', () => {
  let says = 0, does = 0
  for (const schema of SUITE) {
    if (typeof schema !== 'object' || schema === null) continue
    if (needsNormalization(schema, true)) says++
    if (reallyChanges(schema, true)) does++
  }
  // Not an assertion about a number, just a note in the output: the gap is
  // clones that were not needed, which is the direction that is allowed.
  console.log(`        scan says work on ${says}, normalization changes ${does}`)
  assert.ok(says >= does, 'the scan must never claim less work than there is')
})

check('the cases the normalizers actually act on are all caught', () => {
  const cases = [
    ['nullable', { type: 'string', nullable: true }, false],
    ['nullable nested in properties', { properties: { a: { type: 'string', nullable: true } } }, false],
    ['nullable nested in an array keyword', { anyOf: [{ type: 'string', nullable: true }] }, false],
    ['$ref with a dropped sibling', { $ref: '#/x', minimum: 1 }, true],
    ['$ref with only kept siblings', { $ref: '#/x', title: 't' }, true],
    ['fragment-only $id', { $id: '#anchor' }, true],
    ['definitions without $defs', { definitions: { a: {} } }, true],
    ['dependencies', { dependencies: { a: ['b'] } }, true],
    ['array-valued items', { items: [{ type: 'string' }] }, true],
  ]
  for (const [label, schema, asDraft7] of cases) {
    const truth = reallyChanges(schema, asDraft7)
    const said = needsNormalization(schema, asDraft7)
    if (truth) assert.strictEqual(said, true, `${label}: normalization changes it, scan said no`)
  }
})

check('a place the normalizers do not recurse into is still scanned', () => {
  // `contentSchema` is not in any of the normalizers' recursion lists, so a
  // `nullable` in there changes nothing and the scan reports it anyway. That
  // is the pessimistic direction, and it is deliberate: the scan walks every
  // key so that adding a keyword to the normalizers cannot silently outrun it.
  const schema = { contentSchema: { type: 'string', nullable: true } }
  assert.strictEqual(needsNormalization(schema, false), true)
  assert.strictEqual(reallyChanges(schema, false), false)
})

check('a cyclic schema terminates', () => {
  const schema = { properties: {} }
  schema.properties.self = schema
  assert.doesNotThrow(() => scan(schema))
})

check('breaking the scan is caught by the suite property', () => {
  // Proves the first test is load-bearing rather than vacuously passing: a
  // scan which stops descending finds nothing below the root, and the suite
  // then contains schemas it would wrongly skip.
  const shallow = (s, isDraft7) => {
    if (typeof s !== 'object' || s === null) return false
    if ('nullable' in s) return true
    return isDraft7 && (s.definitions !== undefined || s.dependencies !== undefined)
  }
  const missed = SUITE.filter(
    (s) => s && typeof s === 'object' && !shallow(s, true) && reallyChanges(s, true),
  )
  assert.ok(missed.length > 0, 'a deliberately broken scan should miss schemas, so the property has teeth')
  console.log(`        a root-only scan would skip ${missed.length} schemas that need work`)
})

check('the answer is remembered against the schema object', () => {
  const { scan } = require('../lib/schema-scan')
  const schema = { type: 'object', properties: { a: { type: 'string', nullable: true } } }
  const first = scan(schema)
  assert.strictEqual(scan(schema), first, 'same object, same answer')

  // A structurally identical but distinct object is scanned on its own.
  assert.strictEqual(scan(JSON.parse(JSON.stringify(schema))), first)

  // The cache is what makes a shared registry cheap: one scan per distinct
  // schema rather than one per validator that registers it.
  const shared = [{ $id: 'urn:s:1', type: 'object' }, { $id: 'urn:s:2', type: 'object' }]
  const validators = []
  for (let i = 0; i < 20; i++) {
    validators.push(new Validator({ type: 'object', title: 't' + i }, { schemas: shared }))
  }
  for (const v of validators) assert.strictEqual(v.validate({}).valid, true)
})

check('validators sharing a registry do not share what they add to it', () => {
  // The schema map is cached against the registry object and handed to every
  // validator built from it, so a write has to take a private copy first.
  // Without that, addSchema() on one route would silently register the schema
  // for every other route, and for routes built later.
  const shared = [{ $id: 'urn:shared:base', type: 'object' }]
  const first = new Validator({ type: 'object' }, { schemas: shared })
  const second = new Validator({ type: 'object' }, { schemas: shared })

  first.addSchema({ $id: 'urn:private', type: 'string' })

  assert.ok(first._schemaMap.has('urn:private'), 'the one that added it sees it')
  assert.ok(!second._schemaMap.has('urn:private'), 'a sibling does not')

  const third = new Validator({ type: 'object' }, { schemas: shared })
  assert.ok(!third._schemaMap.has('urn:private'), 'nor does one built afterwards')

  for (const v of [first, second, third]) {
    assert.ok(v._schemaMap.has('urn:shared:base'), 'the shared entry survives')
  }
})

check('registering the meta-schemas does not leak into siblings either', () => {
  // The other writer: a schema which references json-schema.org has the
  // vendored meta-schemas added to its map during compilation.
  const shared = [{ $id: 'urn:shared:base2', type: 'object' }]
  const refsMeta = new Validator(
    { $ref: 'https://json-schema.org/draft/2020-12/schema' },
    { schemas: shared },
  )
  const plain = new Validator({ type: 'object' }, { schemas: shared })

  refsMeta.validate({})
  plain.validate({})

  const META = 'https://json-schema.org/draft/2020-12/schema'
  assert.ok(refsMeta._schemaMap.has(META), 'the one that needed them has them')
  assert.ok(!plain._schemaMap.has(META), 'the one that did not, does not')
})

console.log(`\n${passed} passed`)
