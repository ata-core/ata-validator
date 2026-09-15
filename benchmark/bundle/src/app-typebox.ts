import { Hono } from 'hono'
import { Type, FormatRegistry } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
// TypeBox ships no format checkers, and an unregistered format rejects every
// value, so the row would be measuring a broken app without this.
FormatRegistry.Set('email', (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
const Body = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 64 }),
  email: Type.String({ format: 'email' }),
  tags: Type.Optional(Type.Array(Type.String())),
})
const check = TypeCompiler.Compile(Body)
const app = new Hono()
app.post('/u', async (c) => {
  const body = await c.req.json()
  if (!check.Check(body)) return c.json({ ok: false }, 400)
  return c.json({ ok: true, id: (body as any).id })
})
export default app
