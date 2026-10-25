// In-process cost per validated document inside the compiled executable:
// the module from `ata build`, ata's runtime Validator and zod 4 on the same
// 1024 parsed documents (three quarters valid). Built with --compile and
// with --compile --aot by the same bun. Prints ns per document, median of 7
// rounds after a warm-up.
import { Validator } from 'ata-validator'
import * as compiled from '../user.compiled.mjs'
import schema from '../user.schema.json'
import { z } from 'zod'
const runtime = new Validator(schema, { useDefaults: false })
const zodUser = z.object({ email: z.email(), name: z.string().min(1), age: z.int().min(0).max(130), newsletter: z.boolean().optional() }).strict()
const docs: unknown[] = []
for (let i = 0; i < 1024; i++) docs.push(JSON.parse(JSON.stringify(i % 4 ? { email: `u${i}@example.com`, name: 'n' + i, age: 20 + (i % 50), newsletter: i % 2 === 0 } : { email: 'bad', name: '', age: 7, extra: 1 })))
const cands: Record<string, (d: unknown) => boolean> = {
  'ata-module isValid': (d) => compiled.isValid(d),
  'ata-module validate': (d) => compiled.validate(d).valid,
  'ata-runtime isValidObject': (d) => runtime.isValidObject(d),
  'ata-runtime validate': (d) => runtime.validate(d).valid,
  'zod safeParse': (d) => zodUser.safeParse(d).success,
}
const which = (process.env.ONLY || Object.keys(cands).join('|')).split('|')
const N = 300000
for (const name of which) {
  const fn = cands[name]
  let s = 0
  for (let i = 0; i < N; i++) s += fn(docs[i & 1023]) ? 1 : 0
  const R: number[] = []
  for (let r = 0; r < 7; r++) { const t = Bun.nanoseconds(); for (let i = 0; i < N; i++) s += fn(docs[i & 1023]) ? 1 : 0; R.push((Bun.nanoseconds() - t) / N) }
  R.sort((a, b) => a - b)
  console.log(JSON.stringify({ name, nsPerDoc: +R[3].toFixed(1), check: s }))
}
