// The same schema on Cloudflare's runtime: ata's edge entry at run time and
// the module from `ata build`, one route each, plus /newfn, which reports
// whether `new Function` works here.
import * as mod from '../user.compiled.mjs'
import { Validator } from 'ata-validator'
import schema from '../user.schema.json'
const runtime = new Validator(schema, { useDefaults: false })
const kw = (r) => (r.errors || []).map((e) => e.keyword).sort()
export default {
  async fetch (req) {
    const url = new URL(req.url)
    if (url.pathname === '/newfn') { try { new Function('return 1')(); return Response.json({ newFunction: 'allowed' }) } catch (e) { return Response.json({ newFunction: 'blocked (' + e.constructor.name + ')' }) } }
    const body = await req.json()
    const t0 = performance.now()
    const r = url.pathname === '/module' ? mod.validate(body) : runtime.validate(body)
    return Response.json({ valid: r.valid, keywords: kw(r), ms: performance.now() - t0 })
  }
}
