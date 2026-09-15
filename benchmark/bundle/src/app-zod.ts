import { Hono } from 'hono'
import { z } from 'zod'
const Body = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1).max(64),
  email: z.email(),
  tags: z.array(z.string()).optional(),
})
const app = new Hono()
app.post('/u', async (c) => {
  const r = Body.safeParse(await c.req.json())
  if (!r.success) return c.json({ ok: false }, 400)
  return c.json({ ok: true, id: r.data.id })
})
export default app
