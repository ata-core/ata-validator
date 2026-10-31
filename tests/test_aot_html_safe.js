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

// The rewrite is linear in the module. It used to match `\\*<` and so re-read
// a run of backslashes at every `<` after it: an enum value of 40000
// backslashes and `<a` took 6.5 s to emit. Four times the run must cost well
// under four times a quadratic step, and a long run before a `</script` is
// still escaped with the right backslash count.
{
  const time = (n) => {
    const schema = { type: 'string', enum: ['\\'.repeat(n) + '<a'] }
    const t0 = Date.now()
    const src = build.toStandaloneModule(schema, { format: 'cjs' })
    assert.ok(!/<\/script/i.test(src))
    return Date.now() - t0
  }
  time(1000)
  const big = time(160000)
  assert.ok(big < 1500, `160000 backslashes before < took ${big} ms`)
  for (const n of [0, 1, 2, 3, 40000, 40001]) {
    const enumValue = '\\'.repeat(n) + '</script>'
    const src = build.toStandaloneModule({ type: 'string', enum: [enumValue] }, { format: 'cjs' })
    assert.ok(!/<\/script/i.test(src), `run of ${n}`)
    const m = { exports: {} }
    new Function('module', 'exports', src)(m, m.exports)
    assert.strictEqual(m.exports.isValid(enumValue), true, `run of ${n} still means the same string`)
    assert.strictEqual(m.exports.isValid(enumValue.slice(1)), false, `run of ${n} still means the same string`)
  }
}

fs.rmSync(dir, { recursive: true, force: true })
assert.ok(outputs >= 20, `too few outputs checked: ${outputs}`)
assert.ok(compared >= 150, `too few comparisons: ${compared}`)
console.log(`ok: no emitter writes </script or <!-- (${outputs} outputs, ${compared} answers compared with the runtime)`)
