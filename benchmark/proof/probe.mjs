// One probe, run under Node with --disallow-code-generation-from-strings and
// under Bun: the runtime Validator and the module from `ata build` on the
// same schema and documents, whether `new Function` works here, and the
// time from the start of the import to the first validated document.
import { readFileSync } from 'node:fs'
const schema = JSON.parse(readFileSync(new URL('./user.schema.json', import.meta.url), 'utf8'))
const docs = JSON.parse(readFileSync(new URL('./docs.json', import.meta.url), 'utf8'))
let newFunction = 'allowed'
try { new Function('return 1')() } catch (e) { newFunction = 'blocked (' + e.constructor.name + ')' }
const kw = (r) => (r.errors || []).map((e) => e.keyword).sort()
const t0 = performance.now()
const { Validator } = await import('ata-validator')
const v = new Validator(schema, { useDefaults: false })
const rv = v.validate(docs.valid)
const t1 = performance.now()
const ri = v.validate(docs.invalid)
const runtime = { valid: rv.valid, invalid: ri.valid, keywords: kw(ri), firstMs: +(t1 - t0).toFixed(2), engine: typeof v._engine === 'string' ? v._engine : (v._jsFn ? 'generated' : 'interpreted') }
const t2 = performance.now()
const m = await import('./user.compiled.mjs')
const mv = m.validate(docs.valid)
const t3 = performance.now()
const mi = m.validate(docs.invalid)
const mod = { valid: mv.valid, invalid: mi.valid, keywords: kw(mi), firstMs: +(t3 - t2).toFixed(2) }
console.log(JSON.stringify({ env: process.argv[2] || (typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.version), newFunction, runtime, module: mod }))
