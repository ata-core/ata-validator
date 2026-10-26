'use strict'
// `ata verify`: a module from `ata build` is held against the runtime on
// generated documents and the project's samples. Checked: a fresh module
// passes; a module that was tampered with to accept everything is caught; a
// module built from an older schema is reported stale; samples are read and
// counted; the command's exit code says which.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { generate, mutate, verifyOne, ok } = require('../lib/verify')
const { Validator } = require('..')

const order = {
  type: 'object',
  required: ['customer', 'items'],
  additionalProperties: false,
  properties: {
    customer: {
      type: 'object', required: ['id', 'name', 'email'], additionalProperties: false,
      properties: {
        id: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        email: { type: 'string', format: 'email' }
      }
    },
    items: {
      type: 'array', minItems: 1, maxItems: 100,
      items: {
        type: 'object', required: ['sku', 'quantity'], additionalProperties: false,
        properties: { sku: { type: 'string', pattern: '^[a-z0-9-]+$' }, quantity: { type: 'integer', minimum: 1, maximum: 1000 } }
      }
    },
    coupon: { type: 'string', maxLength: 16 },
    status: { enum: ['new', 'paid', 'shipped'] }
  }
}

// The generator: deterministic, and it makes documents on both sides of the
// schema, so a verification exercises refusals too.
{
  const a = generate(order, 100, 7), b = generate(order, 100, 7)
  assert.deepStrictEqual(a, b, 'the same seed makes the same documents')
  const v = new Validator(order)
  const valid = a.filter((d) => v.isValidObject(d)).length
  assert.ok(valid >= 25 && valid <= 85, `expected a mix of valid and invalid documents, got ${valid} valid of 100`)
  assert.ok(a.some((d) => d && d.customer && typeof d.customer.email === 'string'), 'documents follow the schema\'s shape')
  const m = mutate(JSON.parse(JSON.stringify(a[0])), { int: () => 2, pick: (x) => x[0], chance: () => true, next: () => 0 })
  assert.notDeepStrictEqual(m, a[0], 'a mutation changes the document')
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-verify-'))
const bin = path.join(__dirname, '..', 'bin', 'ata.js')
const schemaPath = path.join(dir, 'order.schema.json')
fs.writeFileSync(schemaPath, JSON.stringify(order))
execFileSync(process.execPath, [bin, 'build', schemaPath], { stdio: 'ignore' })
const modulePath = path.join(dir, 'order.compiled.mjs')
assert.ok(fs.existsSync(modulePath))

;(async () => {
  // A fresh module agrees on everything.
  const fresh = await verifyOne({ schemaFile: schemaPath, moduleFile: modulePath, schema: order, generate: 300, seed: 3 })
  assert.ok(ok(fresh), JSON.stringify(fresh.disagreements.slice(0, 3), null, 2))
  // 300 made, plus the documents on either side of each bound the schema states.
  assert.ok(fresh.documents > 300 && fresh.documents <= 600, `documents ${fresh.documents}`)
  assert.strictEqual(fresh.generated, fresh.documents)
  assert.strictEqual(fresh.agree, fresh.documents)
  assert.ok(fresh.valid > 50 && fresh.valid < 250, `mix of verdicts, got ${fresh.valid} valid`)
  assert.strictEqual(fresh.stale, false)
  assert.ok(typeof fresh.ataVersion === 'string')

  // Samples are read: one JSON file, one JSON Lines file, a directory.
  const samples = path.join(dir, 'samples')
  fs.mkdirSync(samples)
  fs.writeFileSync(path.join(samples, 'one.json'), JSON.stringify({ customer: { id: 1, name: 'Ada', email: 'ada@example.com' }, items: [{ sku: 'a-1', quantity: 2 }] }))
  fs.writeFileSync(path.join(samples, 'many.jsonl'), ['{"customer":{"id":0,"name":"","email":"x"},"items":[]}', '{"items":[{"sku":"A","quantity":1}]}', ''].join('\n'))
  const withSamples = await verifyOne({ schemaFile: schemaPath, moduleFile: modulePath, schema: order, generate: 10, seed: 1, samples: [samples] })
  assert.strictEqual(withSamples.samples, 3)
  assert.strictEqual(withSamples.documents, withSamples.generated + 3)
  assert.ok(ok(withSamples))

  // A module tampered with to accept everything is caught, with the documents.
  const tampered = path.join(dir, 'tampered.compiled.mjs')
  const src = fs.readFileSync(modulePath, 'utf8')
  assert.ok(/export \{[^}]*\bisValid\b/.test(src) || /export function isValid/.test(src), 'the module exports isValid')
  fs.writeFileSync(tampered, src + '\nconst _origValidate = validate; export { _alwaysValid as validate2 }; function _alwaysValid () { return { valid: true, errors: [] } }\n'
    .replace('export { _alwaysValid as validate2 }', ''))
  // Simpler and exact: rewrite the exported names to constant functions.
  fs.writeFileSync(tampered, src.replace(/export \{([^}]*)\}/, (m, names) => {
    const list = names.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^isValid$/, '_t1 as isValid').replace(/^validate$/, '_t2 as validate'))
    return `function _t1 () { return true }\nfunction _t2 () { return { valid: true, errors: [] } }\nexport { ${list.join(', ')} }`
  }))
  const bad = await verifyOne({ schemaFile: schemaPath, moduleFile: tampered, schema: order, generate: 100, seed: 5 })
  assert.ok(!ok(bad), 'a module that accepts everything must fail')
  assert.ok(bad.disagreements.length > 0)
  assert.ok(bad.disagreements[0].module.startsWith('valid') && bad.disagreements[0].runtime.startsWith('invalid'), JSON.stringify(bad.disagreements[0]))

  // A module built from an older schema is stale, even where the answers agree.
  const changed = JSON.parse(JSON.stringify(order))
  changed.properties.coupon.maxLength = 32
  const stale = await verifyOne({ schemaFile: schemaPath, moduleFile: modulePath, schema: changed, generate: 20, seed: 1 })
  assert.strictEqual(stale.stale, true)
  assert.ok(!ok(stale))

  // A missing module is reported, not thrown.
  const missing = await verifyOne({ schemaFile: schemaPath, moduleFile: path.join(dir, 'nowhere.compiled.mjs'), schema: order })
  assert.strictEqual(missing.missing, true)

  // The command: exit 0 on a fresh build, the report naming the schema; exit
  // 1 after the schema changes under the module; --json gives the same.
  const run = spawnSync(process.execPath, [bin, 'verify', schemaPath, '--generate', '50', '--samples', samples], { encoding: 'utf8' })
  assert.strictEqual(run.status, 0, run.stdout + run.stderr)
  assert.ok(/order\.schema\.json: \d+ documents \(\d+ generated, 3 from samples\)/.test(run.stdout), run.stdout)
  assert.ok(/every module answers as the runtime does/.test(run.stdout), run.stdout)
  fs.writeFileSync(schemaPath, JSON.stringify(changed))
  const staleRun = spawnSync(process.execPath, [bin, 'verify', schemaPath, '--generate', '20', '--json'], { encoding: 'utf8' })
  assert.strictEqual(staleRun.status, 1, staleRun.stdout)
  const parsed = JSON.parse(staleRun.stdout)
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.schemas[0].stale, true)
  // A bound written one off in the module (a minimum of 1 read as 0) is
  // caught: random documents rarely land on it, the documents on either side
  // of each stated bound do, on a base the runtime accepts, so the verdicts
  // differ and not only the error lists.
  {
    const bounded = { type: 'object', required: ['n', 's'], properties: { n: { type: 'integer', minimum: 13, maximum: 130 }, s: { type: 'string', minLength: 2, maxLength: 5 } } }
    const bp = path.join(dir, 'bounded.schema.json')
    fs.writeFileSync(bp, JSON.stringify(bounded))
    execFileSync(process.execPath, [bin, 'build', bp], { stdio: 'ignore' })
    const mp = path.join(dir, 'bounded.compiled.mjs')
    const good = await verifyOne({ schemaFile: bp, moduleFile: mp, schema: bounded, generate: 40, seed: 2 })
    assert.ok(ok(good), JSON.stringify(good.disagreements.slice(0, 2)))
    const src = fs.readFileSync(mp, 'utf8')
    assert.ok(/<13\b/.test(src), 'the module states the minimum as <13')
    fs.writeFileSync(mp, src.replace(/<13\b/g, '<12'))
    const off = await verifyOne({ schemaFile: bp, moduleFile: mp, schema: bounded, generate: 40, seed: 2 })
    assert.ok(!ok(off), 'a minimum read one off is caught')
    assert.ok(off.disagreements.some((d) => /"n":12\b/.test(d.document) && d.moduleIsValid === true && d.runtimeIsValid === false), JSON.stringify(off.disagreements.slice(0, 2)))
  }

  const none = spawnSync(process.execPath, [bin, 'verify', path.join(dir, 'nothing-here.json')], { encoding: 'utf8' })
  assert.notStrictEqual(none.status, 0)
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('ok: ata verify generates, compares, catches a tampered module and a stale one')
})().catch((e) => { console.error(e); process.exit(1) })
