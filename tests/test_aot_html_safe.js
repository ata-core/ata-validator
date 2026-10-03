'use strict'

// A module ata writes may be inlined into an HTML page inside a <script>
// element, and the HTML parser ends that element at the first `</script` in it,
// whatever JavaScript context that is in. A schema string carrying one, as an
// enum value, a pattern or a property name, ended the element early. Every
// emitter's output now writes the `<` of `</script` and `<!--` as `\x3C`.
// This checks that no such sequence survives in any emitter's output, and that
// the modules still answer as the runtime does on documents carrying the same
// strings, so the rewrite did not change what a literal or a pattern means.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Validator } = require('..')
const build = require('../build')
const aot = require('../lib/aot')

const SCRIPT = '</script><script>globalThis.__ataHtml=1</script>'
const schemas = [
  { type: 'object', properties: { k: { enum: [SCRIPT, '</SCRIPT >', '<!-- c'] } }, required: ['k'] },
  { type: 'object', properties: { [SCRIPT]: { type: 'integer' } }, required: [SCRIPT], additionalProperties: false },
  { type: 'object', properties: { k: { type: 'string', pattern: '^</script>[a-z]*$' } } },
  { type: 'object', properties: { k: { type: 'string', pattern: '^\\</script>$' } } },
  { type: 'object', properties: { k: { const: { '<!--': '</script>' } } } },
  { type: 'object', properties: { k: { type: 'string', errorMessage: 'no </script> here' } } },
]
const docs = [
  { k: SCRIPT }, { k: '</SCRIPT >' }, { k: '<!-- c' }, { k: '</script>abc' }, { k: '</script>' },
  { k: 'x' }, { [SCRIPT]: 1 }, { [SCRIPT]: 'a' }, { k: { '<!--': '</script>' } }, {},
]

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-html-'))
let n = 0
const load = (src) => { const f = path.join(dir, `m${n++}.cjs`); fs.writeFileSync(f, src); return require(f) }
const unsafe = /<\/script|<!--/i

let outputs = 0
let compared = 0
for (const schema of schemas) {
  const v = new Validator(schema)
  const sources = [
    ['compiledModuleFor', build.compiledModuleFor(schema, { format: 'cjs' })],
    ['toStandaloneModule', build.toStandaloneModule(schema, { format: 'cjs' })],
    ['bundleStandalone', build.bundleStandalone([schema], { format: 'cjs' })],
    ['bundleCompact', build.bundleCompact([schema], { format: 'cjs' })],
    ['toStandalone', aot.toStandalone(v)],
  ]
  for (const [name, src] of sources) {
    if (!src) continue
    outputs++
    assert.ok(!unsafe.test(src), `${name} wrote a raw </script or <!-- for ${JSON.stringify(schema)}`)
    if (name === 'toStandalone') continue
    const mod = load(src)
    const check = name.startsWith('bundle')
      ? (d) => { const f = Array.isArray(mod) ? mod[0] : mod.default[0]; const r = f(d); return typeof r === 'boolean' ? r : r.valid }
      : (d) => mod.validate(d).valid
    for (const d of docs) {
      assert.strictEqual(check(structuredClone(d)), v.validate(structuredClone(d)).valid, `${name} on ${JSON.stringify(d)} for ${JSON.stringify(schema)}`)
      compared++
    }
  }
}
assert.strictEqual(globalThis.__ataHtml, undefined, 'nothing ran')

// A module with neither sequence is untouched: no escape is added to it.
{
  const plain = { type: 'object', properties: { a: { type: 'integer', minimum: 1, maximum: 9 } } }
  assert.ok(!build.toStandaloneModule(plain, { format: 'cjs' }).includes('\\x3C'))
}

fs.rmSync(dir, { recursive: true, force: true })
assert.ok(outputs >= 20, `too few outputs checked: ${outputs}`)
assert.ok(compared >= 150, `too few comparisons: ${compared}`)
console.log(`ok: no emitter writes </script or <!-- (${outputs} outputs, ${compared} answers compared with the runtime)`)
