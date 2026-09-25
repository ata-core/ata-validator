'use strict'

// Random schemas and documents, with the two engines held to the same answer.
//
// What this used to do was compare the engine against itself. It built one
// validator, set ATA_FORCE_NAPI, and built a second from the SAME schema object,
// which the identity cache answers with the first instance, so the two results
// came from one compiled function and could not differ. Ten thousand iterations
// finished in under half a second and reported all clear, which is what a
// vacuous check looks like from the outside. It also counted every throw as a
// pass, and used unseeded randomness, so a mismatch could not have been replayed
// even if one had been reported.
//
// Three things make it a real check now: the two validators are built from
// separate schema objects so neither is a cache hit, the comparison is the
// compiled engine against the interpreted one, and the run prints how many
// iterations actually reached the code generator, so the coverage is visible
// rather than assumed.
//
// The generator leans on the shapes that have actually broken: a def on a $ref
// cycle, unevaluated* next to properties, and sibling object nodes each carrying
// their own propertyNames, patternProperties and additionalProperties. A
// constraint that no generated document violates tests nothing, so the
// propertyNames patterns are drawn from ones the key pool does fail.
//
// What this cannot be expected to find, and it was measured rather than assumed:
// the leaked-flag bugs of 1.30.1 and 1.30.2. Reverting either fix and running
// 20000 iterations still reports all clear, because reaching them needs a
// coincidence of three independent draws, one node with patternProperties AND
// propertyNames, a later sibling with propertyNames, and a document whose key
// under that sibling violates it. The joint probability is around one in a
// million per iteration. Random search is the wrong instrument for a coincidence
// that narrow; `test_engine_differential.js` carries those shapes on purpose and
// splits the engines on 12 of its cases without the fix. What this file is good
// for is the wide, shallow sweep, and it earned its keep there: it found that the
// buffer path threw once the native fast-schema registry filled up.
//
// FUZZ_SEED replays a run. FUZZ_ITERATIONS sets the length.

const { Validator } = require('../index')

const ITERATIONS = process.env.FUZZ_ITERATIONS
  ? parseInt(process.env.FUZZ_ITERATIONS, 10)
  : 10000
const SEED = process.env.FUZZ_SEED
  ? parseInt(process.env.FUZZ_SEED, 10) >>> 0
  : (Math.random() * 0x100000000) >>> 0

// mulberry32: small, and the same sequence for the same seed in every runtime.
let _s = SEED
function rnd () {
  _s = (_s + 0x6d2b79f5) >>> 0
  let t = _s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
const int = (n) => Math.floor(rnd() * n)

const TYPES = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']

// ---------------------------------------------------------------------------
// schemas

function objectKeywords (schema, depth) {
  const propCount = int(3) + 1
  schema.properties = {}
  for (let i = 0; i < propCount; i++) schema.properties['p' + i] = randomSchema(depth - 1)

  if (chance(0.5)) {
    schema.required = Object.keys(schema.properties).slice(0, int(propCount) + 1)
  }
  // patternProperties next to propertyNames is how the 1.30.2 bug was reached:
  // the pair sets the flag that a sibling then read.
  if (chance(0.35)) schema.patternProperties = { '^x_': randomSchema(depth - 1) }
  if (chance(0.35)) {
    // The patterns have to be ones the key pool actually violates. An earlier
    // version drew from '^p', '^x_' and '^[a-z]', which nearly every generated
    // key matches, so the constraint never decided a verdict and a missing
    // propertyNames check could not show up.
    schema.propertyNames = chance(0.4)
      ? { maxLength: int(3) + 1 }
      : { pattern: pick(['^q', '^p', '^x_', '^z{2,}$', '^[A-Z]']) }
  }
  if (chance(0.3)) schema.additionalProperties = false
  if (chance(0.15)) schema.unevaluatedProperties = false
  if (chance(0.15) && schema.properties) {
    const key = Object.keys(schema.properties)[0]
    schema.dependentSchemas = { [key]: { required: Object.keys(schema.properties) } }
  }
  if (chance(0.1)) schema.minProperties = int(3)
  if (chance(0.1)) schema.maxProperties = int(4) + 1
}

function randomSchema (depth) {
  if (depth <= 0) return { type: pick(TYPES) }

  // A def on a $ref cycle, which is emitted as a function of its own. Both of
  // the bugs this file is meant to catch lived on that boundary.
  if (depth >= 2 && chance(0.12)) {
    const inner = { type: 'object', properties: { next: { $ref: '#/$defs/node' } } }
    if (chance(0.6)) inner.additionalProperties = false
    if (chance(0.3)) inner.propertyNames = { pattern: '^n' }
    if (chance(0.3)) inner.properties.leaf = randomSchema(depth - 2)
    const root = { $defs: { node: inner }, type: 'object', properties: {} }
    root.properties.a = chance(0.5)
      ? { $ref: '#/$defs/node' }
      : { anyOf: [{ type: 'integer' }, { $ref: '#/$defs/node' }] }
    root.properties.b = randomSchema(depth - 1)
    if (chance(0.4)) root.additionalProperties = false
    return root
  }

  if (chance(0.12)) {
    const branches = [randomSchema(depth - 1), randomSchema(depth - 1)]
    const kw = pick(['anyOf', 'oneOf', 'allOf'])
    return { [kw]: branches }
  }
  if (chance(0.05)) return { not: randomSchema(depth - 1) }
  if (chance(0.05)) {
    return {
      else: randomSchema(depth - 1),
      if: randomSchema(depth - 1),
      then: randomSchema(depth - 1),
    }
  }

  const type = pick(TYPES)
  const schema = { type }

  if (type === 'object' && chance(0.85)) objectKeywords(schema, depth)
  if (type === 'string') {
    if (chance(0.5)) schema.minLength = int(3)
    if (chance(0.5)) schema.maxLength = int(20) + 3
    if (chance(0.2)) schema.pattern = pick(['^[a-z]+$', '^x', '[0-9]'])
  }
  if (type === 'number' || type === 'integer') {
    if (chance(0.5)) schema.minimum = int(10)
    if (chance(0.5)) schema.maximum = int(100)
    if (chance(0.15)) schema.multipleOf = pick([2, 0.5, 3])
  }
  if (type === 'array') {
    if (chance(0.7)) schema.items = randomSchema(depth - 1)
    if (chance(0.2)) schema.prefixItems = [randomSchema(depth - 1)]
    if (chance(0.15)) schema.contains = randomSchema(depth - 1)
    if (chance(0.15)) schema.unevaluatedItems = false
    if (chance(0.5)) schema.minItems = int(3)
    if (chance(0.5)) schema.maxItems = int(10) + 1
    if (chance(0.2)) schema.uniqueItems = true
  }
  return schema
}

// ---------------------------------------------------------------------------
// documents

function randomData (depth) {
  if (depth <= 0) return chance(0.5) ? 'str' : int(100)
  const r = rnd()
  if (r < 0.12) return null
  if (r < 0.24) return chance(0.5)
  if (r < 0.4) return int(200) - 50
  if (r < 0.56) return 'x'.repeat(int(15))
  if (r < 0.8) {
    const obj = {}
    const keys = int(5)
    for (let i = 0; i < keys; i++) {
      // 'next'/'leaf' reach the recursive def, 'x_' the patternProperties,
      // 'zz' is the key that nothing declares.
      const key = pick(['p' + i, 'x_' + i, 'next', 'leaf', 'a', 'b', 'zz'])
      obj[key] = randomData(depth - 1)
    }
    return obj
  }
  const arr = []
  const len = int(5)
  for (let i = 0; i < len; i++) arr.push(randomData(depth - 1))
  return arr
}

// ---------------------------------------------------------------------------
// run

const clone = (value) => JSON.parse(JSON.stringify(value))

// One engine throwing where the other answers is a divergence, so the throw is
// carried rather than swallowed.
function verdict (validator, data) {
  try {
    return { valid: validator.validate(data).valid }
  } catch (error) {
    return { threw: error.message }
  }
}

console.log(`\nDifferential Fuzz: ${ITERATIONS} iterations, seed ${SEED}\n`)

let passed = 0
let mismatches = 0
let reachedCodegen = 0
let declined = 0
let unbuildable = 0

for (let i = 0; i < ITERATIONS; i++) {
  const schema = randomSchema(3)
  const data = randomData(3)

  let cg
  let interp
  try {
    // Separate objects, so neither validator is the other's cache hit.
    cg = new Validator(clone(schema))
    interp = new Validator(clone(schema), { engine: 'interpreter' })
  } catch {
    // A schema this build refuses to accept at all is not a divergence.
    unbuildable++
    continue
  }

  if (cg.engine() === 'codegen') reachedCodegen++
  else declined++

  const a = verdict(cg, data)
  const b = verdict(interp, data)
  const same = a.threw || b.threw
    ? Boolean(a.threw) === Boolean(b.threw)
    : a.valid === b.valid

  if (same) {
    passed++
    continue
  }

  mismatches++
  if (mismatches <= 5) {
    console.log(`  MISMATCH at iteration ${i} (seed ${SEED}):`)
    console.log(`    schema: ${JSON.stringify(schema)}`)
    console.log(`    data:   ${JSON.stringify(data)}`)
    console.log(`    codegen:     ${a.threw ? 'threw ' + a.threw : a.valid}`)
    console.log(`    interpreted: ${b.threw ? 'threw ' + b.threw : b.valid}`)
    console.log('')
  }
}

const pct = (n) => ((n / ITERATIONS) * 100).toFixed(1)
console.log(`  ${passed} agreed, ${mismatches} mismatches out of ${ITERATIONS}`)
console.log(
  `  reached the code generator: ${reachedCodegen} (${pct(reachedCodegen)}%), ` +
    `declined to the interpreter: ${declined} (${pct(declined)}%), ` +
    `would not build: ${unbuildable}`,
)

if (mismatches > 0) {
  if (mismatches > 5) console.log(`\n  ${mismatches - 5} further mismatches not printed`)
  console.log(`\n  FAIL: replay with FUZZ_SEED=${SEED}`)
  process.exit(1)
}

// A run that never reached the code generator would agree about nothing useful.
if (reachedCodegen === 0) {
  console.log('\n  FAIL: no iteration reached the code generator, so nothing was compared')
  process.exit(1)
}

console.log('  All clear\n')
