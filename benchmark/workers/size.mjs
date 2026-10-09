// Bundle size per approach: a Worker with one route for that approach, bundled
// the way wrangler bundles it (esbuild, minified, worker conditions). /none is
// the same app validating nothing, the floor the others are measured against.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'

const head = `import { Hono } from 'hono'
const app = new Hono()
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
`
const variants = {
  none: '',
  'ata-compiled': `import * as m from '../gen/user.compiled.mjs'
route('/ata-compiled', (d) => m.validate(d))`,
  'ata-runtime': `import { Validator } from 'ata-validator/lite'
import schema from '../user.schema.json'
const v = new Validator(schema)
route('/ata-runtime', (d) => v.validate(d))`,
  cfworker: `import { Validator } from '@cfworker/json-schema'
import schema from '../user.schema.json'
const v = new Validator(schema, '2020-12', false)
route('/cfworker', (d) => v.validate(d))`,
  'ajv-standalone': `import validate from '../gen/ajv-standalone.mjs'
route('/ajv-standalone', (d) => validate(d) ? { valid: true } : { valid: false, errors: validate.errors })`,
  'ajv-runtime': `import Ajv from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import schema from '../user.schema.json'
let compiled = null
route('/ajv-runtime', (d) => {
  if (!compiled) { const ajv = new Ajv(); addFormats(ajv); compiled = ajv.compile(schema) }
  return compiled(d) ? { valid: true } : { valid: false, errors: compiled.errors }
})`,
}

mkdirSync('tmp', { recursive: true })
const rows = []
for (const [name, body] of Object.entries(variants)) {
  const file = `tmp/worker-${name}.mjs`
  writeFileSync(file, head + body + '\nexport default app\n')
  const out = await build({ entryPoints: [file], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', conditions: ['workerd', 'worker', 'browser'] })
  const t = out.outputFiles[0].text
  rows.push({ name, min: t.length, gz: gzipSync(t, { level: 9 }).length, newFunction: t.includes('new Function') })
}
const floor = rows.find((r) => r.name === 'none')
console.log('| approach | bundle, minified | gzipped | validation adds | `new Function` in the bundle |')
console.log('|---|---|---|---|---|')
for (const r of rows) console.log(`| ${r.name} | ${(r.min / 1000).toFixed(1)} KB | ${(r.gz / 1000).toFixed(1)} KB | ${r.name === 'none' ? '' : ((r.gz - floor.gz) / 1000).toFixed(1) + ' KB'} | ${r.newFunction ? 'yes' : 'no'} |`)
rmSync('tmp', { recursive: true, force: true })
