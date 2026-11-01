// The IR's front end and closure backend, bundled and minified the way a
// browser build bundles them, must answer as they do unbundled. A minifier
// renames functions, so nothing may hang on a function's name: the guard a
// kernel takes was once picked by `K.on.name`, and in a minified bundle it
// picked the wrong one.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const here = path.dirname(fileURLToPath(import.meta.url))
const { compile } = await import('../lib/ir/run.mjs')

// One schema per guard (string, number, array, object, any) and the rest.
const SCHEMAS = [
  { type: 'object', properties: { s: { minLength: 2, maxLength: 4, pattern: '^a', format: 'email' }, n: { minimum: 1, maximum: 9, exclusiveMinimum: 0, multipleOf: 2 }, a: { minItems: 1, maxItems: 2, uniqueItems: true, contains: { const: 1 } }, o: { minProperties: 1, maxProperties: 2, required: ['x'] }, e: { enum: [1, 'b'] }, c: { const: { k: 1 } } }, additionalProperties: false },
  { anyOf: [{ type: 'string', minLength: 3 }, { type: 'number', minimum: 10 }] },
  { $defs: { node: { type: 'object', properties: { v: { type: 'integer' }, next: { $ref: '#/$defs/node' } } } }, $ref: '#/$defs/node' },
]
const DOCS = [{ s: 'x', n: 0.5, a: [2, 2, 3], o: {}, e: 2, c: { k: 2 }, z: 1 }, { s: 'abcd@e.co', n: 4, a: [1], o: { x: 1 }, e: 'b', c: { k: 1 } }, 'ab', 5, 12, { v: 1, next: { v: 'x', next: { v: 2.5 } } }, null, [], {}]

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-ir-min-'))
const entry = path.join(dir, 'entry.mjs')
fs.writeFileSync(entry, `import { compile } from ${JSON.stringify(path.join(here, '..', 'lib', 'ir', 'run.mjs'))}\nexport const run = (s, d) => compile(s, {}).validate(d)\n`)
const out = path.join(dir, 'out.mjs')
esbuild.buildSync({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', platform: 'browser', outfile: out, logLevel: 'error' })
const min = await import(pathToFileURL(out).href)
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => Object.keys(e).map((k) => [k, e[k] === undefined ? '<undef>' : e[k]]))])
let failed = 0
for (const s of SCHEMAS) {
  const plain = compile(s, {})
  for (const d of DOCS) {
    const a = shape(plain.validate(structuredClone(d))); const b = shape(min.run(s, structuredClone(d)))
    if (a !== b) { failed++; console.log('FAIL', JSON.stringify(s).slice(0, 80), JSON.stringify(d), '\n  unbundled', a.slice(0, 300), '\n  minified ', b.slice(0, 300)) }
  }
}
fs.rmSync(dir, { recursive: true, force: true })
if (failed) process.exit(1)
console.log('ok: the IR minified in a browser bundle answers as it does unbundled')
