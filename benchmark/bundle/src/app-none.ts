import { Hono } from 'hono'
const app = new Hono()
app.post('/u', async (c) => {
  const body = await c.req.json()
  return c.json({ ok: true, id: body.id })
})
export default app
