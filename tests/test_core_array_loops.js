'use strict'

// The verdict core's array loop (lib/core/verdict.js arrSimple) runs one
// tight loop per item code and keeps the general loop for the codes it does
// not name. Each item code here, for each schema that reaches it, is checked
// against the small engine's isValid on arrays of every JSON type, with holes,
// NaN, the infinities, -0 and the edges of int32 and 2^31. Every schema is
// first confirmed to reach the code it is listed under, so a code the loops
// stop naming still has cases. Each check is built fresh and asked each
// array several times in two orders, so the first call (which reads the item
// schema) and the calls after warm-up are both compared.

const assert = require('node:assert')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
require(path.join(ROOT, 'lib/validator-small.js')).Validator.use(...require(path.join(ROOT, 'lib/features/groups.js')).all)
const verdict = require(path.join(ROOT, 'lib/core/verdict.js'))
const { createSmall } = require(path.join(ROOT, 'lib/engine-small.js'))

const OPTS = { flat: true, schemaMap: null, formats: null, v1: false }
const I32 = 2 ** 31

// Item schemas by the code inline() gives them. Code 0 is any schema the
// loop calls as a function.
const ITEMS = {
  1: [{ type: 'string' }],
  2: [{ type: 'number' }],
  3: [{ type: 'integer' }],
  4: [{ type: 'boolean' }],
  5: [{ type: 'null' }],
  6: [{}, { description: 'any' }, true],
  7: [{ const: 0 }, { const: -0 }, { const: 1 }, { const: 'a' }, { const: null }, { const: true }, { const: false }, { type: 'number', const: 1.5 }, { const: I32 }],
  8: [
    { type: 'integer', minimum: 0, maximum: 65535 },
    { type: 'integer', minimum: -I32, maximum: I32 - 1 },
    { type: 'integer', minimum: -I32 - 1, maximum: I32 },
    { type: 'integer', minimum: 0 },
    { type: 'integer', maximum: -0 },
    { type: 'integer', minimum: 0.5, maximum: 3.5 },
    { type: 'integer', minimum: I32 - 1, maximum: 2 ** 32 }
  ],
  9: [
    { type: 'number', minimum: -1.5, maximum: 1e300 },
    { type: 'number', minimum: 0 },
    { type: 'number', maximum: -0 },
    { type: 'number', minimum: -I32, maximum: I32 - 1 },
    { type: 'number', minimum: -Infinity, maximum: Infinity }
  ],
  10: [{ type: 'string', minLength: 2, maxLength: 3 }, { type: 'string', minLength: 1 }, { type: 'string', maxLength: 0 }],
  11: [{ type: 'string', enum: ['a', 'ab'] }, { enum: ['a', ''] }],
  0: [
    { type: 'string', pattern: '^a' },
    { type: ['string', 'number'] },
    { type: 'object' },
    { type: 'array' },
    { multipleOf: 2 },
    { not: { type: 'string' } },
    { type: 'array', items: { type: 'number' } },
    { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] },
    { enum: [1, 'a', null] },
    { const: [1] },
    false
  ]
}

const VALUES = [
  0, -0, 1, -1, 1.5, -1.5, 3, 65535, 65536, NaN, Infinity, -Infinity,
  I32 - 1, I32, I32 + 1, -I32, -I32 - 1, 2 ** 32, 2 ** 53, -(2 ** 53), 1e300, -1e300, Number.MIN_VALUE,
  '', 'a', 'ab', 'abc', 'abcd', 'b', '\u{1F642}\u{1F642}', '\ud800b',
  true, false, null, undefined, {}, { a: 1 }, { a: 'x' }, [], [1], ['a'], [1, 'a']
]

// The arrays: each value alone, repeated, after and before values of every
// kind, and arrays with holes.
function arrays () {
  const out = [[]]
  for (const v of VALUES) out.push([v], [v, v, v])
  for (const a of VALUES) for (const b of VALUES) out.push([a, b])
  for (const v of VALUES) {
    out.push([1, 2, 3, v], [v, 1, 2, 3], ['a', 'ab', v], [v, 'a', 'ab'], [0, 1, 65535, v])
  }
  const holes = [new Array(1), new Array(3), [1, , 2], [, 'a'], ['a', , ], [0.5, , 1.5]] // eslint-disable-line no-sparse-arrays
  out.push(...holes)
  // Long arrays, so the loops run past any unrolling.
  out.push(Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.1))
  out.push(Array.from({ length: 1024 }, (_, i) => (i * 61) & 65535))
  out.push(Array.from({ length: 64 }, (_, i) => 'tag' + i))
  const late = Array.from({ length: 300 }, (_, i) => i); late[299] = NaN; out.push(late)
  const lateS = Array.from({ length: 300 }, () => 'ab'); lateS[298] = 1; out.push(lateS)
  const lateH = Array.from({ length: 300 }, () => 1); delete lateH[150]; out.push(lateH)
  return out
}
const ARRAYS = arrays()
const NON_ARRAYS = [null, 1, 'a', {}, { length: 1, 0: 1 }, undefined, true]

const failed = []
let checks = 0
const seenCodes = new Set()
const show = (x) => Array.isArray(x) ? '[' + Array.from({ length: Math.min(x.length, 8) }, (_, i) => i in x ? show(x[i]) : '<hole>').join(',') + (x.length > 8 ? ',... (' + x.length + ')' : '') + ']' : Object.is(x, -0) ? '-0' : typeof x === 'number' ? String(x) : x === undefined ? 'undefined' : JSON.stringify(x)

function compare (schema, docs, label) {
  const want = createSmall(schema, OPTS)
  assert.ok(want !== null, 'the small engine takes ' + label)
  // Two fresh cores, one asked the arrays in order and one in reverse, so
  // the first array that reads the item schema differs.
  for (const order of [docs, [...docs].reverse()]) {
    const got = verdict.createVerdict(schema, OPTS)
    assert.ok(typeof got === 'function', 'the verdict core takes ' + label)
    for (let r = 0; r < 3; r++) {
      for (const d of order) {
        const w = want.isValid(d), g = got(d)
        checks++
        if (w !== g) { failed.push(`${label} on ${show(d)}: core ${g}, small engine ${w}`); return }
      }
    }
  }
}

const CTX = new verdict._i.Ctx(null, null, false)
for (const code of Object.keys(ITEMS)) {
  for (const items of ITEMS[code]) {
    const [c] = verdict._i.inline(CTX, items)
    assert.strictEqual(c, +code, `${JSON.stringify(items)} is listed under code ${code} but inline() gives ${c}`)
    seenCodes.add(c)
    for (const shell of [{ type: 'array' }, {}, { type: 'array', minItems: 1 }, { type: 'array', maxItems: 2 }, { type: 'array', minItems: 2, maxItems: 300 }]) {
      const schema = { ...shell, items }
      compare(schema, [...ARRAYS, ...NON_ARRAYS], JSON.stringify(schema))
    }
  }
}
// No items: every array of the right length is valid.
for (const shell of [{ type: 'array' }, { type: 'array', minItems: 1, maxItems: 2 }]) compare(shell, [...ARRAYS, ...NON_ARRAYS], JSON.stringify(shell))

// Every code inline() can give has cases above.
for (let c = 0; c <= 11; c++) assert.ok(seenCodes.has(c), 'no item schema reaches code ' + c)

// A hole reads through Array.prototype, in both engines alike.
Array.prototype[1] = 'x' // eslint-disable-line no-extend-native
try {
  for (const code of [1, 2, 0, 10]) {
    const items = ITEMS[code][0]
    compare({ type: 'array', items }, [[1, , 2], ['a', , 'b'], ['ab', , 'cd'], new Array(3)], 'polluted prototype, items ' + JSON.stringify(items)) // eslint-disable-line no-sparse-arrays
  }
} finally { delete Array.prototype[1] }

if (failed.length) { console.error(failed.join('\n')); process.exit(1) }
console.log(`core array loops: ${checks} checks, item codes ${[...seenCodes].sort((a, b) => a - b).join(' ')}, all agree with the small engine`)
