import { Hono } from 'hono'
import { Validator } from 'ata-validator'
const Body = {
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 64 },
    email: { type: 'string', format: 'email' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'email'],
} as const
const check = new Validator(Body)
const app = new Hono()
app.post('/u', async (c) => {
  const body = await c.req.json()
  if (!check.isValidObject(body)) return c.json({ ok: false }, 400)
  return c.json({ ok: true, id: (body as any).id })
})
export default app
