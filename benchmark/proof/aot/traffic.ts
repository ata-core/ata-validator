// Lemire-style run: 1024 distinct orders, 1 to 12 items, names and emails
// of varying length, 10% invalid in six different ways spread through the
// stream (so the early exits mispredict as they would in traffic), the same
// order of documents for every validator, ns per document and MB/s of JSON
// text, medians of 7 rounds, two passes. The verdicts are summed and
// compared across validators.
import { validate } from 'bun:bundle'
import * as z from 'zod'
import type { Schema } from 'bun'
import type { Order as BunOrder } from './validated.ts'
import * as ata from './order.compiled.mjs'

type Order = { customer: { id: number & Schema.Int & Schema.Min<1> & Schema.Max<9007199254740991>; name: string & Schema.MinLength<1> & Schema.MaxLength<100>; email: string & Schema.Pattern<'^[^@\\s]+@[^@\\s]+$'> }; items: { sku: string & Schema.MinLength<1> & Schema.MaxLength<32>; quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<1000>; unitCents: number & Schema.Int & Schema.Min<0> & Schema.Max<9007199254740991> }[] & Schema.MinItems<1> & Schema.MaxItems<100>; coupon?: string & Schema.MaxLength<16> } & Schema.DeepStrict
const ZodOrder = z.strictObject({
  customer: z.strictObject({ id: z.int().min(1), name: z.string().min(1).max(100), email: z.string().regex(/^[^@\s]+@[^@\s]+$/) }),
  items: z.array(z.strictObject({ sku: z.string().min(1).max(32), quantity: z.int().min(1).max(1000), unitCents: z.int().min(0) })).min(1).max(100),
  coupon: z.string().max(16).optional(),
})

let seed = 0x9e3779b9
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
const names = ['Ada', 'Zoë Müller', 'Grace Brewster Murray Hopper', 'Li', 'Ömer Faruk Yıldırım-Kaya', 'Jean-Baptiste de la Fontaine du Bois']
const texts: string[] = []; const expected: boolean[] = []
for (let i = 0; i < 1024; i++) {
  const n = 1 + Math.floor(rnd() * 12)
  const o: any = { customer: { id: 1 + Math.floor(rnd() * 1e6), name: names[i % names.length], email: `user${i}@example${i % 7}.com` }, items: [] as any[] }
  for (let j = 0; j < n; j++) o.items.push({ sku: `SKU-${1000 + Math.floor(rnd() * 9000)}${j % 3 ? '-X' : ''}`, quantity: 1 + Math.floor(rnd() * 20), unitCents: Math.floor(rnd() * 100000) })
  if (rnd() < 0.5) o.coupon = rnd() < 0.5 ? 'TENOFF' : 'SPRING'
  let ok = true
  if (i % 10 === 3) { ok = false; switch (Math.floor(rnd() * 6)) {
    case 0: o.items[n - 1].quantity = 0; break
    case 1: o.customer.email = 'not an email'; break
    case 2: o.items[0].extra = 1; break
    case 3: o.customer.id = 1.5; break
    case 4: o.items[Math.floor(n / 2)].sku = ''; break
    default: o.coupon = 'A'.repeat(17) } }
  texts.push(JSON.stringify(o)); expected.push(ok)
}
const docs = texts.map((t) => JSON.parse(t))
const bytes = texts.reduce((s, t) => s + t.length, 0)
const cands: Record<string, (b: unknown) => boolean> = {
  'zod safeParse': (b) => ZodOrder.safeParse(b).success,
  'validate<Order> (Bun type)': (b) => { try { validate<BunOrder>(b); return true } catch { return false } },
  'validate<Order> (type from schema)': (b) => { try { validate<Order>(b); return true } catch { return false } },
  'ata module isValid': (b) => ata.isValid(b),
}
const only = (process.env.ONLY || Object.keys(cands).join('|')).split('|')
for (const name of only) { const f = cands[name]!; let wrong = 0; for (let i = 0; i < 1024; i++) if (f(docs[i]) !== expected[i]) wrong++; if (wrong) { console.log('VERDICTS DIFFER', name, wrong); process.exit(1) } }
console.log(`1024 orders, ${bytes} bytes of JSON, ${expected.filter((e) => !e).length} invalid`)
for (let pass = 0; pass < 2; pass++) for (const name of only) {
  const f = cands[name]!
  let s = 0
  for (let r = 0; r < 200; r++) for (let i = 0; i < 1024; i++) s += f(docs[i]) ? 1 : 0
  const R: number[] = []
  for (let r = 0; r < 7; r++) { const t = Bun.nanoseconds(); for (let k = 0; k < 100; k++) for (let i = 0; i < 1024; i++) s += f(docs[i]) ? 1 : 0; R.push((Bun.nanoseconds() - t) / (100 * 1024)) }
  R.sort((a, b) => a - b)
  console.log(JSON.stringify({ pass, name, nsPerDoc: +R[3]!.toFixed(0), MBps: +(bytes / 1024 / R[3]! * 1000).toFixed(0), check: s }))
}
