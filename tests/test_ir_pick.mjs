// pickModules (lib/ir/pick.mjs): one backend for a set of schemas, by what
// the sources weigh. Held here to what it promises: a single form stays a
// written module, several forms go behind one runtime, rich errors never
// take closures, a schema a backend refuses is written as a module beside
// the others, and, bundled for a browser, the choice is not larger than the
// written modules it replaced.
import assert from 'node:assert'
import zlib from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { pickModules } from '../lib/ir/index.mjs'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const here = path.dirname(fileURLToPath(import.meta.url))
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length

const FIELDS = {
  email: { type: 'string', format: 'email', maxLength: 254 }, name: { type: 'string', minLength: 1, maxLength: 100 },
  phone: { type: 'string', pattern: '^\\+?[0-9 ()-]{7,20}$' }, age: { type: 'integer', minimum: 0, maximum: 150 },
  price: { type: 'number', exclusiveMinimum: 0 }, country: { enum: ['TR', 'US', 'DE', 'FR'] }, terms: { type: 'boolean' },
  tags: { type: 'array', items: { type: 'string', maxLength: 30 }, maxItems: 10 },
  address: { type: 'object', required: ['street'], properties: { street: { type: 'string', minLength: 1 }, zip: { type: 'string', pattern: '^[0-9]{5}$' } } },
}
const names = Object.keys(FIELDS)
let seed = 3; const rnd = (n) => { seed = (seed * 16807) % 2147483647; return Math.floor(seed / 2147483647 * n) }
const form = () => { const ks = names.filter(() => rnd(2)); if (ks.length < 3) ks.push('name', 'age', 'terms'); const u = [...new Set(ks)]; return { type: 'object', properties: Object.fromEntries(u.map((k) => [k, FIELDS[k]])), required: u.slice(0, 2), additionalProperties: rnd(2) === 0 ? false : true } }
const forms = Array.from({ length: 12 }, form)

// The real bundle of a set of sources, minified and gzipped.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-pick-'))
function bundle (sources) {
  sources.forEach((s, i) => fs.writeFileSync(path.join(dir, `m${i}.mjs`), s.source.replace(/from "ata-validator\/kernels"/g, `from ${JSON.stringify(path.join(here, '../lib/kernels/index.mjs'))}`)))
  const entry = sources.map((_, i) => `import * as F${i} from "./m${i}.mjs"`).join('\n') + `\nglobalThis.F=[${sources.map((_, i) => 'F' + i)}]`
  return gz(esbuild.buildSync({ stdin: { contents: entry, resolveDir: dir, loader: 'js' }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' }).outputFiles[0].text)
}

const plain = { richErrors: false }
const one = pickModules(forms.slice(0, 1), plain, gz, { verdict: true })
assert.strictEqual(one.backend, 'module', 'a single form is a written module')
assert.strictEqual(one.sources[0].kind, 'module')

let moved = 0
for (const n of [2, 3, 5, 8, 12]) {
  const set = forms.slice(0, n)
  const pick = pickModules(set, plain, gz, { verdict: true })
  const base = pickModules(set, plain, () => 0, { verdict: true })
  assert.strictEqual(base.backend, 'module', 'nothing saved, nothing chosen')
  const chosen = bundle(pick.sources); const written = bundle(base.sources)
  assert.ok(chosen <= written, `${n} forms as ${pick.backend}: ${chosen} bytes, written modules ${written}`)
  if (pick.backend !== 'module') moved++
  if (n >= 5) assert.strictEqual(pick.backend, 'closures', `${n} forms of plain errors go behind the closures (${pick.backend}, saving ${pick.saving})`)
}
assert.ok(moved >= 3)

// Rich errors: closures do not write them, plans do.
const rich = pickModules(forms, {}, gz, { verdict: true })
assert.strictEqual(rich.backend, 'table')
assert.ok(rich.sources.every((s) => s.kind === 'table'))
assert.ok(bundle(rich.sources) <= bundle(pickModules(forms, {}, () => 0, { verdict: true }).sources))

// A schema the closures refuse is a module beside the others; one the module
// writer refuses is null.
const mixed = pickModules([...forms, { anyOf: [{ type: 'string' }, { type: 'integer' }] }, { type: 'string', coolKeywordFn: () => 1, $ref: 'https://nowhere.example/x' }], plain, gz, { verdict: true })
assert.strictEqual(mixed.backend, 'closures')
assert.strictEqual(mixed.sources[forms.length].kind, 'module')
assert.strictEqual(mixed.sources[forms.length + 1], null)
assert.ok(mixed.sources.slice(0, forms.length).every((s) => s.kind === 'closures'))

fs.rmSync(dir, { recursive: true, force: true })
console.log(`ok: pickModules keeps one form a written module, puts several behind one runtime (${moved} of 5 sets), and its choice was never the larger bundle`)
