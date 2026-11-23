// The options a build writes into a module of ata-validator/ir rather than a
// wrapper (lib/compiled-common.js BUILD_OPTIONS): `formats` given as
// functions, each a call in the module the caller binds with setFormats();
// `schemas`, resolved while compiling; `assertFormat`. A custom format is
// never written as no check and never as the built-in check of the same name,
// a reference that resolves to nothing refuses the schema under strictRefs,
// and every module answers as the runtime given the same options does
// (scripts/build-options-differential.js, the whole suite here).
//
// The table writer (lib/ir/table.mjs) takes `formats` as holes, assertFormat
// and strictRefs too, and is held to the same: the differential runs both
// writers, and each block below has the table's cases beside the module's.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { specialize, tableModule, tablePlan } from '../lib/ir/index.mjs'

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
    for (const backend of ['module', 'table']) {
      const of = report.filter((r) => r.backend === backend)
      assert.strictEqual(stats[backend].diffs, 0, `${backend} against the root Validator: ` + JSON.stringify(of.slice(0, 2)).slice(0, 1500))
      assert.strictEqual(stats[backend].v2Diffs, 0, `${backend} against the 2.0 browser entry: ` + JSON.stringify(of.slice(0, 2)).slice(0, 1500))
    }
    assert.ok(stats.module.compiled > 2000, `compiled ${stats.module.compiled} option sets`)
    assert.ok(stats.module.withHoles > 150, `${stats.module.withHoles} of them with format holes`)
    // The table declines more (it returns null for `schemas`), and a table
    // that declined everything would pass the lines above.
    assert.ok(stats.table.compiled > 1800, `the table compiled ${stats.table.compiled} option sets`)
    assert.ok(stats.table.withHoles > 150, `${stats.table.withHoles} of them with format holes`)
    // The one known difference (the runtime asserting a format under
    // assertFormat: false) has no case in the suite; SchemaStore has one.
    assert.strictEqual(stats.table.runtimeFormatOff, 0)
    assert.strictEqual(stats.module.runtimeFormatOff, 0)
  }

  // The same differential with every hole call taken out of the modules:
  // it has to fail, or it proves nothing about the holes.
  // In a plan the hole is the step's check (`,UF0,` in the step), called by
  // the interpreter: there it is replaced with a function that answers true.
  {
    const replaced = { module: 0, table: 0 }
    const { stats } = await run({ mutate: (src, backend) => backend === 'module'
      ? src.replace(/\bUF\d+\(([^()]*)\)/g, () => { replaced.module++; return 'true' })
      : src.replace(/,UF\d+,/g, () => { replaced.table++; return ',()=>true,' }) })
    assert.ok(replaced.module > 100, `the mutation replaced ${replaced.module} hole calls`)
    assert.ok(stats.module.diffs > 100, `a module without its hole calls was caught (${stats.module.diffs} differences)`)
    assert.ok(replaced.table > 100, `the mutation replaced ${replaced.table} hole steps`)
    assert.ok(stats.table.diffs > 100, `a plan without its hole checks was caught (${stats.table.diffs} differences)`)
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
      // The table writer: a plan with the same holes, or none at all where
      // the schema reaches a registered document.
      for (const richErrors of [false, true]) {
        const tab = tableModule(schema, { ...opts, formats, holes: true, strictRefs: true, richErrors })
        if (schemas) { assert.strictEqual(tab, null, 'the table declines `schemas`'); continue }
        assert.ok(/^export function setFormats\(/m.test(tab), 'the plan has holes')
        const t = await load(tab)
        assert.deepStrictEqual([...t.formatHoles].sort(), [...m.formatHoles].sort())
        t.setFormats(formats)
        for (const d of bad) {
          assert.strictEqual(t.isValid(d), false, `plan rejects ${JSON.stringify(d)}`)
          const r = t.validate(d)
          assert.strictEqual(r.valid, false)
          assert.ok(r.errors.some((e) => e.keyword === 'format'), 'with a format error')
          // Every field of every error, as the runtime with the same functions gives them.
          if (richErrors) assert.deepStrictEqual(JSON.parse(JSON.stringify(r.errors)), JSON.parse(JSON.stringify(new Validator(schema, { formats }).validate(d).errors)), `plan errors on ${JSON.stringify(d)}`)
        }
        for (const d of good) assert.strictEqual(t.isValid(d), true, `plan accepts ${JSON.stringify(d)}`)
      }
    }
  }

  // A function under a built-in name with a hint (email): the errors of the
  // plan, the module and the runtime are the same in every field, the
  // suggestion among them.
  {
    const schema = { type: 'object', properties: { mail: { type: 'string', format: 'email' }, when: { type: 'string', format: 'date' } } }
    const formats = { email: (s) => s.endsWith('.test') }
    const doc = { mail: 'nope', when: '2026-13-45' }
    const want = JSON.parse(JSON.stringify(new Validator(schema, { formats }).validate(doc).errors))
    assert.strictEqual(want.length, 2)
    assert.ok(want[0].suggestion, 'the runtime gives the hint of the name')
    for (const src of [specialize(schema, { formats, holes: true, strictRefs: true }), tableModule(schema, { formats, holes: true, strictRefs: true })]) {
      const m = await load(src)
      m.setFormats(formats)
      assert.deepStrictEqual(JSON.parse(JSON.stringify(m.validate(doc).errors)), want)
      assert.strictEqual(m.isValid({ mail: 'x.test', when: '2026-11-23' }), true)
    }
  }

  // Each hole takes the function of its own name: two formats whose
  // functions answer opposite ways on the same strings.
  {
    const schema = { type: 'object', properties: { tint: { type: 'string', format: 'color' }, file: { type: 'string', format: 'data-url' } } }
    const formats = { color: (s) => s === 'c', 'data-url': (s) => s === 'd' }
    for (const [name, src] of [['module', specialize(schema, { formats, holes: true, richErrors: false })], ['plan', tableModule(schema, { formats, holes: true, richErrors: false })]]) {
      const m = await load(src)
      // Given in the other order, and with a key that is no format's.
      m.setFormats({ other: () => true, 'data-url': formats['data-url'], color: formats.color })
      assert.strictEqual(m.isValid({ tint: 'c', file: 'd' }), true, name)
      assert.deepStrictEqual(m.validate({ tint: 'd', file: 'c' }).errors.map((e) => e.instancePath + ' ' + e.params.format), ['/tint color', '/file data-url'], name)
      assert.deepStrictEqual(m.validate({ tint: 'c', file: 'c' }).errors.map((e) => e.instancePath), ['/file'], name)
      assert.deepStrictEqual(m.validate({ tint: 'd', file: 'd' }).errors.map((e) => e.instancePath), ['/tint'], name)
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

  // The same of a plan, which is stricter before setFormats(): there is no
  // plan until the functions are taken, so every check throws, one that
  // would not reach the format too. A setFormats() that throws leaves it so.
  {
    const schema = { type: 'string', format: 'color' }
    for (const richErrors of [false, true]) {
      const m = await load(tableModule(schema, { formats: { color: () => true }, holes: true, richErrors }))
      assert.deepStrictEqual([...m.formatHoles], ['color'])
      for (const d of ['x', 5]) {
        assert.throws(() => m.isValid(d), TypeError)
        assert.throws(() => m.validate(d), TypeError)
      }
      assert.throws(() => m.setFormats({}), /setFormats\(\) has no function for format "color"/)
      assert.throws(() => m.setFormats({ color: /x/ }), TypeError)
      assert.throws(() => m.setFormats(Object.create({ color: () => true })), TypeError, 'own properties only')
      assert.throws(() => m.setFormats(null), TypeError)
      assert.throws(() => m.setFormats(), TypeError)
      assert.throws(() => m.isValid('x'), TypeError, 'still no plan')
      m.setFormats({ color: (s) => s === 'ok' })
      assert.strictEqual(m.isValid('ok'), true)
      assert.strictEqual(m.isValid('no'), false)
      assert.strictEqual(m.validate('no').errors[0].keyword, 'format')
      // A later setFormats() that throws keeps the plan it had, whole.
      assert.throws(() => m.setFormats({}), TypeError)
      assert.strictEqual(m.isValid('no'), false)
    }
    // Two holes, one function missing: no plan, not half of one.
    const two = await load(tableModule({ properties: { a: { format: 'color' }, b: { format: 'shade' } } }, { formats: { color: () => true, shade: () => true }, holes: true }))
    assert.throws(() => two.setFormats({ color: () => false }), /no function for format "shade"/)
    assert.throws(() => two.isValid({ a: 'x' }), TypeError)
    const bare = await load(tableModule({ format: 'color' }, { formats: { color: () => true }, holes: true }))
    bare.setFormats({ color: () => false })
    assert.strictEqual(bare.isValid(5), true, 'a format reads strings only')
    assert.strictEqual(bare.isValid('x'), false)
    // Without `holes` a function format is declined, and a plan sent as data
    // never carries one.
    assert.strictEqual(tableModule(schema, { formats: { color: () => true } }), null)
    assert.strictEqual(tablePlan(schema, { formats: { color: () => true }, holes: true }), null)
    assert.strictEqual(tablePlan(schema, { formats: { color: () => true } }), null)
    // A value that is not a function is no format, as the runtime reads it.
    const none = tableModule(schema, { formats: { color: /x/ }, holes: true })
    assert.ok(none !== null && !/setFormats/.test(none))
    assert.strictEqual((await load(none)).isValid('anything'), new Validator(schema, { formats: { color: /x/ } }).isValidObject('anything'))
    // assertFormat: false takes the format away, the hole with it.
    assert.ok(!/setFormats/.test(tableModule(schema, { formats: { color: () => true }, holes: true, assertFormat: false })))
    // A function under a name every object inherits is declined: the
    // runtime throws for some of them and words the error its own way for
    // the others.
    for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      const formats = Object.defineProperty({}, name, { value: () => true, enumerable: true })
      assert.strictEqual(tableModule({ type: 'string', format: name }, { formats, holes: true }), null, name)
    }
    // A reference that resolves to nothing declines.
    assert.strictEqual(tableModule({ $ref: '#/$defs/missing' }, { strictRefs: true }), null)
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
    let plan = 0
    const t = await load(tableModule(schema, { formats: { color: () => true }, holes: true }))
    t.setFormats({ color: () => { plan++; return true } })
    t.isValid('x')
    assert.strictEqual(plan, 2)
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

  // assertFormat: false as the runtime reads it: `format` removed by the
  // runtime's own walk of the root schema, which follows keywords only, so a
  // format reached through a reference to a place that is not a keyword is
  // still checked (SchemaStore's travis). Skipping every format accepted what
  // the runtime rejects.
  {
    const schema = { definitions: { holder: { url: { type: 'string', format: 'uri' } } }, properties: { u: { $ref: '#/definitions/holder/url' }, v: { type: 'string', format: 'uri' } } }
    const m = await load(specialize(schema, { assertFormat: false }))
    for (const d of [{ u: 'a b' }, { v: 'a b' }, { u: 'https://e.com' }]) {
      assert.strictEqual(m.isValid(d), new Validator(schema, { assertFormat: false }).isValidObject(d), JSON.stringify(d))
      assert.strictEqual(m.isValid(d), new V2(schema, { assertFormat: false }).isValidObject(d), JSON.stringify(d) + ' (2.0 entry)')
    }
    assert.strictEqual(m.isValid({ u: 'a b' }), false)
    assert.strictEqual(m.isValid({ v: 'a b' }), true)
    // The table writer asserts no format under assertFormat: false, the one
    // behind the reference too: { u: 'a b' } is valid. The runtime and the
    // module above reject it, which is the runtime's bug (the differential
    // counts it apart as runtimeFormatOff until the runtime is fixed). With
    // a function for the format the plan has no hole and never calls it.
    const uri = (s) => s === 'ok'
    for (const [o, src] of [[{ assertFormat: false }, tableModule(schema, { assertFormat: false })], [{ assertFormat: false }, tableModule(schema, { assertFormat: false, richErrors: false })], [{ assertFormat: false, formats: { uri } }, tableModule(schema, { assertFormat: false, formats: { uri }, holes: true })]]) {
      const t = await load(src)
      if (t.setFormats) t.setFormats(o.formats)
      assert.ok(!/setFormats/.test(src), 'no hole')
      for (const d of [{ u: 'a b' }, { v: 'a b' }, { u: 'https://e.com' }, { u: 'ok' }]) {
        assert.strictEqual(t.isValid(d), true, 'plan ' + JSON.stringify(d))
        assert.deepStrictEqual(t.validate(d).errors, [], 'plan ' + JSON.stringify(d))
      }
      assert.strictEqual(t.isValid({ u: 5 }), false, 'the type beside the format is still checked')
    }
    // The same plan as data.
    const { fromPlan } = await import('../lib/kernels/plan-rich.mjs')
    const plan = await fromPlan(JSON.parse(JSON.stringify(tablePlan(schema, { assertFormat: false }))))
    assert.strictEqual(plan.isValid({ u: 'a b' }), true, 'the plan as data asserts no format either')
    assert.strictEqual(plan.isValid({ v: 'a b' }), true)
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
