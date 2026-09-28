'use strict'

// A required object or array is read into a local once, and its checks read
// the local. Reading `d["customer"]` afresh on every line cost a plain order
// verdict 42 percent. This checks the emitted source reads each container
// once, and that the verdict still agrees with the interpreted engine on
// mutated documents: missing and retyped members, inherited members, objects
// with another prototype or none. It reports how much it compared.

const assert = require('assert')
const { compileToJSCodegen } = require('../lib/js-compiler')
const { Validator } = require('..')

const order = {
  type: 'object',
  required: ['id', 'customer', 'items', 'shippingAddress'],
  properties: {
    id: { type: 'string' },
    customer: {
      type: 'object',
      required: ['id', 'email', 'name'],
      properties: { id: { type: 'integer', minimum: 1 }, email: { type: 'string' }, name: { type: 'string', minLength: 1, maxLength: 100 }, phone: { type: 'string', maxLength: 20 } },
    },
    items: {
      type: 'array', minItems: 1, maxItems: 50,
      items: { type: 'object', required: ['sku', 'quantity'], properties: { sku: { type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' }, quantity: { type: 'integer', minimum: 1 } } },
    },
    shippingAddress: {
      type: 'object',
      required: ['city', 'country'],
      properties: { city: { type: 'string', minLength: 1 }, country: { type: 'string', minLength: 2, maxLength: 2 }, lines: { type: 'array', items: { type: 'string' } } },
    },
    coupon: { type: 'string' },
  },
}

const src = compileToJSCodegen(order, null, null)._source
for (const k of ['customer', 'items', 'shippingAddress']) {
  const reads = src.split(`d[${JSON.stringify(k)}]`).length - 1
  assert.strictEqual(reads, 1, `${k} is read ${reads} times in the verdict, expected once`)
}

const good = {
  id: 'o-1',
  customer: { id: 7, email: 'a@b.co', name: 'Ada', phone: '555' },
  items: [{ sku: 'ABC-1234', quantity: 2 }, { sku: 'XYZ-0001', quantity: 1 }],
  shippingAddress: { city: 'Izmir', country: 'TR', lines: ['a', 'b'] },
  coupon: 'SAVE',
}
const v = new Validator(order)
const ref = new Validator(order, { engine: 'interpreter' })

let x = 0x2545f491
const r = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k }
const vals = [null, 0, -1, 1.5, '', [], {}, 'x', true, [{}], 'ABC-12345']
function mutate (o) {
  if (typeof o !== 'object' || o === null) return
  const ks = Object.keys(o)
  if (!ks.length) return
  const k = ks[r(ks.length)]
  const m = r(6)
  if (m === 0) delete o[k]
  else if (m === 1) o[k] = vals[r(vals.length)]
  else if (m === 2) Object.setPrototypeOf(o, null)
  else if (m === 3) { const p = Object.create({ [k]: o[k] }); Object.assign(p, o); delete p[k]; return p }
  else mutate(o[k])
}

let compared = 0, rejected = 0, bad = 0
for (let i = 0; i < 20000; i++) {
  let d = structuredClone(good)
  for (let k = r(3); k >= 0; k--) { const p = mutate(d); if (p) d = p }
  // The mutations reach nested members too; replace a nested object with one
  // whose members are inherited.
  if (r(5) === 0) d.customer = Object.assign(Object.create({ name: 'Inherited' }), { id: 1, email: 'e' })
  const want = ref.validate(d).valid
  compared++
  if (!want) rejected++
  if (v.isValidObject(d) !== want || v.validate(d).valid !== want) {
    if (bad++ < 5) console.error('disagreement on', JSON.stringify(d), 'interpreter says', want)
  }
}
assert.strictEqual(bad, 0, `${bad} disagreements with the interpreted engine`)
assert.ok(compared === 20000 && rejected > 5000 && compared - rejected > 1000, `compared ${compared}, rejected ${rejected}: not a real mix`)
console.log(`ok: containers read once, verdict agrees with the interpreter on ${compared} documents (${rejected} rejected)`)
