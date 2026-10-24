// Runs in a page under a Content-Security-Policy without 'unsafe-eval'. The
// runtime bundle is ata's browser entry; the module is the one from `ata build`.
import { Validator } from 'ata-validator'
import * as mod from '../user.compiled.mjs'
import schema from '../user.schema.json'
import docs from '../docs.json'
let newFunction = 'allowed'
try { new Function('return 1')() } catch (e) { newFunction = 'blocked (' + e.constructor.name + ')' }
const kw = (r) => (r.errors || []).map((e) => e.keyword).sort()
const t0 = performance.now()
const v = new Validator(schema, { useDefaults: false })
const rv = v.validate(docs.valid); const t1 = performance.now(); const ri = v.validate(docs.invalid)
const t2 = performance.now(); const mv = mod.validate(docs.valid); const t3 = performance.now(); const mi = mod.validate(docs.invalid)
document.body.textContent = 'RESULT ' + JSON.stringify({ env: 'chrome, CSP script-src self', newFunction,
  runtime: { valid: rv.valid, invalid: ri.valid, keywords: kw(ri), firstMs: +(t1 - t0).toFixed(2) },
  module: { valid: mv.valid, invalid: mi.valid, keywords: kw(mi), firstMs: +(t3 - t2).toFixed(2) } })
