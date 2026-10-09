// One Worker, the same schema validated five ways, one route each. Every route
// takes a POST body, validates it, and answers 200 or 400 with the errors.
// /none validates nothing and is the floor the others are measured against.
import { Hono } from 'hono'
import * as ataCompiled from '../gen/user.compiled.mjs'
import { Validator } from 'ata-validator/lite'
import { Validator as CfWorker } from '@cfworker/json-schema'
import ajvStandalone from '../gen/ajv-standalone.mjs'
import Ajv from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import schema from '../user.schema.json'

const app = new Hono()

const ataRuntime = new Validator(schema)
const cfworker = new CfWorker(schema, '2020-12', false)

function route (path, check) {
  app.post(path, async (c) => {
    let body
    try { body = await c.req.json() } catch { return c.json({ error: 'bad json' }, 400) }
    let r
    try { r = check(body) } catch (e) { return c.json({ error: e.name + ': ' + e.message }, 500) }
    return r.valid ? c.json({ ok: true }) : c.json({ errors: r.errors }, 400)
  })
}

route('/none', () => ({ valid: true }))
route('/ata-compiled', (d) => ataCompiled.validate(d))
route('/ata-runtime', (d) => ataRuntime.validate(d))
route('/cfworker', (d) => cfworker.validate(d))
route('/ajv-standalone', (d) => ajvStandalone(d) ? { valid: true } : { valid: false, errors: ajvStandalone.errors })
let ajvCompiled = null
route('/ajv-runtime', (d) => {
  // Compiles on the first request, which is where Workers refuse it.
  if (!ajvCompiled) { const ajv = new Ajv(); addFormats(ajv); ajvCompiled = ajv.compile(schema) }
  return ajvCompiled(d) ? { valid: true } : { valid: false, errors: ajvCompiled.errors }
})

export default app
