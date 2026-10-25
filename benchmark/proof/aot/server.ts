// One Hono server, three routes on the same body: the module from `ata build`
// (plain JavaScript, no new Function), ata's runtime Validator (compiles the
// schema at startup with new Function), and zod 4 for scale. /none validates
// nothing. The same answers on every route: 200 or 400 with the first error.
import { Hono } from 'hono'
import { sValidator } from '@hono/standard-validator'
import { Validator } from 'ata-validator'
import * as compiled from '../user.compiled.mjs'
import schema from '../user.schema.json'
import { z } from 'zod'
const runtime = new Validator(schema, { useDefaults: false })
const zodUser = z.object({ email: z.email(), name: z.string().min(1), age: z.int().min(0).max(130), newsletter: z.boolean().optional() }).strict()
const app = new Hono()
const answer = (c: any, valid: boolean, first: string) => valid ? c.json({ ok: true }) : c.json({ error: first }, 400)
app.post('/none', async (c) => { await c.req.json(); return c.json({ ok: true }) })
app.post('/ata-module', async (c) => { const r = compiled.validate(await c.req.json()); return answer(c, r.valid, r.valid ? '' : (r.errors[0].message ?? '')) })
app.post('/ata-runtime', async (c) => { const r = runtime.validate(await c.req.json()); return answer(c, r.valid, r.valid ? '' : (r.errors[0].message ?? '')) })
app.post('/zod', async (c) => { const r = zodUser.safeParse(await c.req.json()); return answer(c, r.success, r.success ? '' : (r.error.issues[0].message ?? '')) })
const port = Number(process.env.PORT || 3123)
export default { port, fetch: app.fetch }
console.log('listening', port)
