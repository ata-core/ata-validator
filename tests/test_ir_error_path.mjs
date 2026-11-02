// The IR's error path does no work a passing check does not need.
// 1. The kernels' typo distance (lib/kernels/rt.mjs osa) is the bounded one of
//    lib/levenshtein.js: same answers, so the same suggestions.
// 2. With a list of errors to fill, an anyOf or oneOf runs its verdict first
//    and builds its branches' errors only when it fails: a propertyNames
//    anyOf that passed for every key used to build one error per key and
//    throw it away. Counted through the error constructor, in both backends.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { compileClosures } from '../lib/ir/index.mjs'
import * as K from '../lib/kernels/index.mjs'
import { osa } from '../lib/kernels/rt.mjs'
const require = createRequire(import.meta.url)
const { levenshtein } = require('../lib/levenshtein.js')
const { Validator } = require('../index.js')

let seed = 7
const rnd = (k) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % k }
const letters = 'abcab-_.'
const word = () => { let s = ''; const n = rnd(9); for (let i = 0; i < n; i++) s += letters[rnd(letters.length)]; return s }
let pairs = 0
for (let i = 0; i < 100000; i++) {
  const a = word(); const b = word(); const max = [undefined, 0, 1, 2, 3][rnd(5)]
  assert.strictEqual(osa(a, b, max), levenshtein(a, b, max), `osa(${JSON.stringify(a)}, ${JSON.stringify(b)}, ${max})`)
  pairs++
}

const schema = {
  type: 'object',
  properties: {
    env: {
      type: 'object',
      propertyNames: { anyOf: [{ pattern: '^[^$]' }, { enum: ['$schema', '$comment'] }] },
      additionalProperties: { type: 'string' },
      maxProperties: 50,
    },
    pick: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  },
}
const env = Object.fromEntries([...Array(60)].map((_, i) => ['K' + i, 'v']))
// [document, whether every anyOf and oneOf in it passes]
const docs = [
  [{ env, pick: 'a' }, true],
  [{ env: { K: 'v', $schema: 'x' }, pick: 1 }, true],
  [{ env: { K: 'v', $bad: 'x' }, pick: 1.5 }, false],
  [{ env: { K: 1 }, pick: 'a' }, true],
]
let built = 0
const counted = { ...K, E: (...a) => { built++; return K.E(...a) } }
const mod = new Function('K', functionBody(specialize(schema, { assertFormat: false, verdict: true })))(counted)
const ata = new Validator(schema)
for (const [d, passing] of docs) {
  const want = ata.validate(d).errors.length
  built = 0
  assert.strictEqual(mod.validate(d).errors.length, want, `module, ${JSON.stringify(d).slice(0, 80)}`)
  // A failing branch keyword builds its branches' errors to collapse them.
  if (passing) assert.strictEqual(built, want, `module built ${built} errors for ${want} reported on ${JSON.stringify(d).slice(0, 80)}`)
}
// The closures take the kernels from the import; count through the list
// instead: a passing anyOf leaves no error behind and builds none.
const closures = compileClosures(schema, { assertFormat: false })
for (const [d] of docs) assert.strictEqual(closures.validate(d).errors?.length ?? 0, ata.validate(d).errors.length, `closures, ${JSON.stringify(d).slice(0, 80)}`)

console.log(`ok: the kernels' typo distance agrees with lib/levenshtein.js on ${pairs} pairs, and a passing anyOf or oneOf builds no errors`)
