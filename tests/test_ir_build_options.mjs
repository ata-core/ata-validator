// The options a build writes into a module of ata-validator/ir rather than a
// wrapper (lib/compiled-common.js BUILD_OPTIONS): `formats` given as
// functions, each a call in the module the caller binds with setFormats();
// `schemas`, resolved while compiling; `assertFormat`. A custom format is
// never written as no check and never as the built-in check of the same name,
// a reference that resolves to nothing refuses the schema under strictRefs,
// and every module answers as the runtime given the same options does
// (scripts/build-options-differential.js, the whole suite here).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { specialize } from '../lib/ir/index.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { Validator } = require('../index.js')
const { Validator: V2 } = await import('../index.v2.browser.mjs')
const { run } = require('../scripts/build-options-differential.js')

const KERNELS = pathToFileURL(path.join(ROOT, 'lib/kernels/index.mjs')).href
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-build-options-test-')))
let n = 0
const load = async (src) => { const f = path.join(dir, `m${n++}.mjs`); fs.writeFileSync(f, src.replace(/"ata-validator\/kernels"/g, JSON.stringify(KERNELS))); return import(pathToFileURL(f).href) }

try {
  // The differential over the official suite with its remotes: formats as
  // stand-in functions, assertFormat: false, both, and `schemas`.
  {
    const { stats, report } = await run()
    assert.strictEqual(stats.diffs, 0, 'module against the root Validator: ' + JSON.stringify(report.slice(0, 2)).slice(0, 1500))
    assert.strictEqual(stats.v2Diffs, 0, 'module against the 2.0 browser entry: ' + JSON.stringify(report.slice(0, 2)).slice(0, 1500))
    assert.ok(stats.compiled > 2000, `compiled ${stats.compiled} option sets`)
    assert.ok(stats.withHoles > 150, `${stats.withHoles} of them with format holes`)
  }

  // The same differential with every hole call taken out of the modules:
  // it has to fail, or it proves nothing about the holes.
  {
    let replaced = 0
    const { stats } = await run({ mutate: (src) => src.replace(/\bUF\d+\(([^()]*)\)/g, () => { replaced++; return 'true' }) })
    assert.ok(replaced > 100, `the mutation replaced ${replaced} hole calls`)
    assert.ok(stats.diffs > 100, `a module without its hole calls was caught (${stats.diffs} differences)`)
  }

  // Documents that fail only the custom format: the runtime with a format
  // that accepts everything takes them, the runtime with the caller's
  // function refuses them, and so does the module.
  {
    const color = (s) => /^#[0-9a-f]{6}$/i.test(s)
    const dataUrl = (s) => /^data:/.test(s)
    const phone = (s) => /^\+?[0-9 ]{7,15}$/.test(s)
    const cases = [
      [{ type: 'object', properties: { tint: { type: 'string', format: 'color' }, file: { type: 'string', format: 'data-url' }, mail: { type: 'string', format: 'email' } } }, { color, 'data-url': dataUrl },
        [{ tint: 'red' }, { file: 'http://x' }, { tint: '#12345' }, { tint: '#00ff00', file: 'x' }], [{ tint: '#00ff00', file: 'data:,a', mail: 'a@b.co' }, {}]],
      [{ type: 'object', required: ['phone'], properties: { phone: { type: 'string', format: 'phone' }, email: { type: 'string', format: 'email' } }, additionalProperties: false }, { phone },
        [{ phone: 'x' }, { phone: '12' }, { phone: '+90 555 1234567 999' }], [{ phone: '+90 555 1234567' }]],
      // A user function under a built-in name replaces the built-in check.
      [{ type: 'string', format: 'email' }, { email: (s) => s.endsWith('.test') }, ['a@b.co'], ['x.test']],
      // Under a reference and in a registered document.
      [{ $ref: 'https://e.com/c.json#/$defs/t' }, { color }, ['red'], ['#abcdef'], [{ $id: 'https://e.com/c.json', $defs: { t: { type: 'string', format: 'color' } } }]],
    ]
    for (const [schema, formats, bad, good, schemas] of cases) {
      const any = Object.fromEntries(Object.keys(formats).map((k) => [k, () => true]))
      const opts = schemas ? { schemas } : {}
      const src = specialize(schema, { ...opts, formats, holes: true, strictRefs: true, richErrors: false })
      assert.ok(/^export function setFormats\(/m.test(src), 'the module has holes')
      const m = await load(src)
      m.setFormats(formats)
      for (const d of bad) {
        assert.strictEqual(new Validator(schema, { ...opts, formats: any }).isValidObject(d), true, `${JSON.stringify(d)} fails only the custom format`)
        assert.strictEqual(new Validator(schema, { ...opts, formats }).isValidObject(d), false)
        assert.strictEqual(new V2(schema, { ...opts, formats }).isValidObject(d), false)
        assert.strictEqual(m.isValid(d), false, `module rejects ${JSON.stringify(d)}`)
        const r = m.validate(d)
        assert.strictEqual(r.valid, false)
        assert.ok(r.errors.some((e) => e.keyword === 'format'), 'with a format error')
      }
      for (const d of good) assert.strictEqual(m.isValid(d), true, `module accepts ${JSON.stringify(d)}`)
    }
  }

  // A hole is never a silent pass: before setFormats() a check that reaches
  // it throws, setFormats() refuses a missing or non-function value, and
  // without `holes` a function format is refused at build time.
  {
    const schema = { type: 'string', format: 'color' }
    const m = await load(specialize(schema, { formats: { color: () => true }, holes: true }))
    assert.deepStrictEqual([...m.formatHoles], ['color'])
    assert.throws(() => m.isValid('x'), TypeError)
    assert.throws(() => m.setFormats({}), /setFormats\(\) has no function for format "color"/)
    assert.throws(() => m.setFormats({ color: /x/ }), TypeError)
    assert.throws(() => m.setFormats(Object.create({ color: () => true })), TypeError, 'own properties only')
    m.setFormats({ color: (s) => s === 'ok' })
    assert.strictEqual(m.isValid('ok'), true)
    assert.strictEqual(m.isValid('no'), false)
    const bare = await load(specialize({ format: 'color' }, { formats: { color: () => true }, holes: true }))
    bare.setFormats({ color: () => false })
    assert.strictEqual(bare.isValid(5), true, 'a format reads strings only')
    assert.strictEqual(bare.isValid('x'), false)
    assert.throws(() => specialize(schema, { formats: { color: () => true } }), /closure backend/)
    // assertFormat: false takes the format away, the hole with it.
    assert.ok(!/setFormats/.test(specialize(schema, { formats: { color: () => true }, holes: true, assertFormat: false })))
  }

  // A hole runs as often as the check reaches it: the repeat of a check in a
  // row of statements is not skipped when it holds one.
  {
    const schema = { $defs: { c: { type: 'string', format: 'color' } }, allOf: [{ $ref: '#/$defs/c' }], anyOf: [{ $ref: '#/$defs/c' }] }
    let calls = 0
    const m = await load(specialize(schema, { formats: { color: () => true }, holes: true, verdict: true }))
    m.setFormats({ color: () => { calls++; return true } })
    m.isValid('x')
    let rt = 0
    new V2(schema, { formats: { color: () => { rt++; return true } } }).isValidObject('x')
    assert.strictEqual(calls, 2)
    assert.strictEqual(rt, 2)
  }

  // References into registered documents: the cases of the master fix for
  // relative references in registered documents (3429ae8, 45052bb). Each one
  // the IR cannot resolve the way the runtime's resolver does is refused under
  // strictRefs; the others agree with the runtime, and the document after
  // defaults too.
  {
    const refused = {
      missing: [{ $ref: 'https://example.com/a.json' }, [{ $id: 'https://example.com/a.json', properties: { p: { $ref: 'missing.json#/definitions/x' } } }]],
      'matched by file name only': [{ $ref: 'https://example.com/a.json' }, [{ $id: 'https://example.com/a.json', properties: { p: { $ref: 'b.json' } } }, { $id: 'https://other.org/b.json', type: 'string' }]],
      'fragment-only two documents out': [{ definitions: { x: { type: 'number' } }, $ref: 'https://example.com/a.json' }, [{ $id: 'https://example.com/a.json', properties: { p: { $ref: 'b.json' } } }, { $id: 'https://example.com/b.json', properties: { q: { $ref: '#/definitions/x' } } }]],
    }
    for (const [name, [schema, schemas]] of Object.entries(refused)) {
      assert.throws(() => specialize(schema, { schemas, strictRefs: true }), /^Error: ir: /, name)
    }
    const agree = {
      'pointer in the second document': [{ $ref: 'https://example.com/a.json' }, [{ $id: 'https://example.com/a.json', properties: { p: { $ref: 'b.json' } }, definitions: { x: { type: 'number' } } }, { $id: 'https://example.com/b.json', properties: { q: { $ref: '#/definitions/x' } }, definitions: { x: { type: 'string' } } }], [{ p: { q: 1 } }, { p: { q: 'x' } }]],
      'a cycle across documents': [{ $ref: 'https://example.com/a.json' }, [{ $id: 'https://example.com/a.json', type: 'object', properties: { b: { $ref: 'b.json' }, n: { type: 'integer' } } }, { $id: 'https://example.com/b.json', type: 'object', properties: { a: { $ref: 'a.json' }, s: { type: 'string' } } }], [{ b: { a: { n: 1, b: { s: 'x' } } } }, { b: { a: { n: 'x' } } }, { b: { s: 3 } }]],
      'relative to the registered document': [{ $ref: 'https://example.com/dir/a.json' }, [{ $id: 'https://example.com/dir/a.json', properties: { p: { $ref: '../b.json#/definitions/x' } } }, { $id: 'https://example.com/b.json', definitions: { x: { type: 'integer' } } }], [{ p: 1 }, { p: 'no' }]],
      'keyed by URI, a default behind the reference': [{ $ref: 'https://example.com/c.json#/definitions/y' }, { 'https://example.com/c.json': { definitions: { y: { type: 'object', properties: { z: { default: 'filled' } }, required: ['k'] } } } }, [{ k: 1 }, {}]],
    }
    for (const [name, [schema, schemas, docs]] of Object.entries(agree)) {
      const m = await load(specialize(schema, { schemas, strictRefs: true, richErrors: false }))
      for (const d of docs) {
        const a = structuredClone(d); const b = structuredClone(d); const c = structuredClone(d)
        const want = new Validator(schema, { schemas, richErrors: false }).validate(a)
        const v2 = new V2(schema, { schemas, richErrors: false }).validate(c)
        const got = m.validate(b)
        assert.strictEqual(got.valid, want.valid, `${name} ${JSON.stringify(d)}`)
        assert.strictEqual(got.valid, v2.valid, `${name} ${JSON.stringify(d)} (2.0 entry)`)
        assert.deepStrictEqual(b, a, `${name}: the document after defaults`)
      }
    }
  }

  // assertFormat: false asserts no format, wherever the schema that holds it
  // sits: one reached through a reference to a place that is not a keyword
  // (SchemaStore's travis) is skipped like any other, by the module and by
  // both runtimes (tests/test_assert_format_off.js).
  {
    const schema = { definitions: { holder: { url: { type: 'string', format: 'uri' } } }, properties: { u: { $ref: '#/definitions/holder/url' }, v: { type: 'string', format: 'uri' } } }
    const m = await load(specialize(schema, { assertFormat: false }))
    for (const d of [{ u: 'a b' }, { v: 'a b' }, { u: 'https://e.com' }]) {
      assert.strictEqual(m.isValid(d), new Validator(schema, { assertFormat: false }).isValidObject(d), JSON.stringify(d))
      assert.strictEqual(m.isValid(d), new V2(schema, { assertFormat: false }).isValidObject(d), JSON.stringify(d) + ' (2.0 entry)')
    }
    assert.strictEqual(m.isValid({ u: 'a b' }), true)
    assert.strictEqual(m.isValid({ v: 'a b' }), true)
  }

  // The wrapper still refuses what it cannot reproduce; the build lists the
  // options it writes into a module apart, so a plugin that knows only
  // compiledOptions does not take them.
  {
    const build = require('../build.js')
    assert.deepStrictEqual([...build.compiledOptions], ['useDefaults'])
    assert.deepStrictEqual([...build.compiledBuildOptions], ['assertFormat', 'formats', 'schemas'])
    const { fromCompiled } = require('../lib/compiled.js')
    const mod = { isValid: () => true, validate: () => ({ valid: true, errors: [] }) }
    for (const k of ['formats', 'schemas', 'assertFormat']) assert.throws(() => fromCompiled(mod, {}, { [k]: k === 'assertFormat' ? false : {} }), /stay on the runtime/)
  }
  console.log('test_ir_build_options: ok')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
