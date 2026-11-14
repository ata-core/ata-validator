// specialize(schema, { smallFormats: true }) names the smaller check of a
// format where lib/kernels/formats-small.mjs has one. The module has to
// answer as the Validator does, with the same errors, and a module written
// without the option has to stay as it was.
import assert from 'node:assert'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { specialize } from '../lib/ir/index.mjs'
const { Validator } = createRequire(import.meta.url)('..')
const kernels = new URL('../lib/kernels/index.mjs', import.meta.url).href
const load = (src) => import('data:text/javascript,' + encodeURIComponent(src.replace(/(['"])ata-validator\/kernels\1/g, `'${kernels}'`)))

const SMALL = ['email', 'uri', 'uri-reference']
const extra = ['', 'a', 'a@b', 'a@b.co', '"quoted"@example.com', 'a@[IPv6:::1]', 'a@[1.2.3.4]', 'a..b@example.com', 'http://example.com', 'http://[::1]:80/x?y#z', 'http://exa mple.com', '//host/path', '../a/b', '#frag', 'a b', 'mailto:x@y.z', 'urn:isbn:0451450523', '%zz', 'http://a/%41']
let schemas = 0; let docs = 0; let refused = 0
for (const dialect of ['draft2020-12', 'draft2019-09', 'draft7']) {
  for (const format of SMALL) {
    const file = new URL(`./suite/tests/${dialect}/optional/format/${format}.json`, import.meta.url)
    if (!fs.existsSync(file)) continue
    for (const group of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      for (const richErrors of [true, false]) {
        const opts = { richErrors, assertFormat: true }
        const want = new Validator(group.schema, opts)
        const src = specialize(group.schema, { ...opts, smallFormats: true })
        const fn = 'fmt_' + format.replace(/-/g, '_')
        assert.ok(new RegExp('\\b' + fn + '_s\\b').test(src), `${format}: the module names ${fn}_s`)
        assert.ok(!new RegExp('\\b' + fn + '\\b(?!_s)').test(src.split('\n')[0]), `${format}: the module does not import ${fn}`)
        assert.ok(!specialize(group.schema, opts).includes(fn + '_s'), `${format}: without the option the module names the scanner`)
        const mod = await load(src)
        schemas++
        for (const d of [...group.tests.map((t) => t.data), ...extra]) {
          const w = want.validate(d)
          const r = mod.validate(d)
          assert.strictEqual(r.valid, w.valid, `${dialect} ${format} valid on ${JSON.stringify(d)}`)
          assert.strictEqual(mod.isValid(d), w.valid, `${dialect} ${format} isValid on ${JSON.stringify(d)}`)
          assert.deepStrictEqual(JSON.parse(JSON.stringify(r.errors)), JSON.parse(JSON.stringify(w.errors)), `${dialect} ${format} errors on ${JSON.stringify(d)}`)
          docs++; if (!w.valid) refused++
        }
      }
    }
  }
}
assert.ok(schemas >= 18, `only ${schemas} schemas were read; is tests/suite checked out?`)
assert.ok(refused > docs / 4, `only ${refused} of ${docs} documents were refused; is the format asserted?`)
console.log(`ok: modules with smallFormats answer as the Validator, ${schemas} modules, ${docs} documents, ${refused} refused`)
