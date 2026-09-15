import { Hono } from 'hono'
import * as v from 'valibot'
const Body = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  email: v.pipe(v.string(), v.email()),
  tags: v.optional(v.array(v.string())),
})
const app = new Hono()
app.post('/u', async (c) => {
  const r = v.safeParse(Body, await c.req.json())
  if (!r.success) return c.json({ ok: false }, 400)
  return c.json({ ok: true, id: r.output.id })
})
export default app
