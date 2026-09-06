'use strict'

// A rejection on the buffer path must not cost a multiple of an acceptance.
//
// The bytecode plan used to return the same false for "constraint violated"
// and "hit a COMPOSITION opcode, cannot decide", so every rejection fell
// through to a second full walk of the DOM and cost about twice an acceptance
// (and before 1.10.0, with the On-Demand path re-parsing on failure, up to 8x).
// The plan now reports which of the two its false was, and a decisive reject
// returns without the second walk.
//
// The schema here uses const, which keeps the On-Demand plan out (unsupported)
// while staying fully decidable by the bytecode plan: exactly the shape where
// the double walk lived. The budget is a ratio, not a time, so machine speed
// does not matter; the bug regime measured 1.9x on every payload size, the
// fixed regime 1.0x, and the gate sits between them with margin both ways.

const { Validator } = require('..')

const schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      kind: { const: 'product' },
      id: { type: 'integer', minimum: 0 },
      name: { type: 'string', minLength: 1, maxLength: 64 },
      price: { type: 'number', minimum: 0 },
    },
    required: ['kind', 'id', 'name', 'price'],
  },
}

const v = new Validator(schema)
try {
  v.isValid(Buffer.from('[]'))
} catch {
  console.log('buffer reject cost: native engine absent, nothing to measure')
  process.exit(0)
}

const mkItem = (i) => ({ kind: 'product', id: i, name: 'item-' + i, price: i * 1.5 })
const good = Array.from({ length: 800 }, (_, i) => mkItem(i))
const bad = good.slice()
bad[799] = { ...mkItem(799), name: '' }
const gb = Buffer.from(JSON.stringify(good))
const bb = Buffer.from(JSON.stringify(bad))

if (v.isValid(gb) !== true || v.isValid(bb) !== false) {
  console.error('FAIL buffer reject cost: verdicts wrong before measuring')
  process.exit(1)
}

// warm up both paths, then medians of interleaved rounds
for (let i = 0; i < 50; i++) { v.isValid(gb); v.isValid(bb) }
const N = 60
const acc = []
const rej = []
for (let r = 0; r < 9; r++) {
  let t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) v.isValid(gb)
  acc.push(Number(process.hrtime.bigint() - t))
  t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) v.isValid(bb)
  rej.push(Number(process.hrtime.bigint() - t))
}
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
const ratio = median(rej) / median(acc)

const BUDGET = 1.5
if (ratio > BUDGET) {
  console.error(`FAIL buffer reject cost: reject/accept ratio ${ratio.toFixed(2)} exceeds ${BUDGET}, the second DOM walk is back`)
  process.exit(1)
}
console.log(`buffer reject cost: reject/accept ratio ${ratio.toFixed(2)} (budget ${BUDGET})`)
