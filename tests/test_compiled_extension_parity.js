'use strict'

// A check the schema does not carry, registered through _extendChecks the way
// @ata-project/keywords registers `instanceof` and `typeof`, must be answered
// by the compiled wrappers exactly as the runtime answers it: fromCompiled()
// on all four entry points, fromCompiledVerdict() on the two that return a
// boolean, the input after a call included, since defaults fill it. A bundler
// plugin puts these wrappers in place of `withKeywords(new Validator(schema))`,
// so a difference here is a difference a user would see.
//
// The check here stands in for a keyword: every property named `when` must be
// a Date, reported per path in the keyword's own error shape. It is registered
// once, twice (the checks combine), and as a resolver that returns null.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Validator } = require('..')
const { compiledModuleFor, compiledSchemaFor } = require('../build')
const { fromCompiled } = require('../lib/compiled')
const { fromCompiledVerdict } = require('../lib/compiled-verdict')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-ext-'))
let n = 0
const load = (src) => { const f = path.join(dir, `m${n++}.cjs`); fs.writeFileSync(f, src); return require(f) }

// Every `when` in the document, at any depth, must be a Date.
function walk (d, p, out) {
  if (d === null || typeof d !== 'object' || d instanceof Date) return
  for (const k of Object.keys(d)) {
    const v = d[k], at = p + '/' + k
    if (k === 'when' && !(v instanceof Date)) out.push({ keyword: 'instanceof', instancePath: at, schemaPath: '#', params: { instanceof: 'Date' }, message: 'must be an instance of Date' })
    walk(v, at, out)
  }
}
const whenCheck = () => ({
  check: (d) => { const o = []; walk(d, '', o); return o.length === 0 },
  errors: (d) => { const o = []; walk(d, '', o); return o.length ? o : null },
})
// A second keyword: `tag`, where present, must not be the string 'bad'.
const tagCheck = () => ({
  check: (d) => !(d && typeof d === 'object' && d.tag === 'bad'),
  errors: (d) => (d && typeof d === 'object' && d.tag === 'bad') ? [{ keyword: 'typeof', instancePath: '/tag', schemaPath: '#', params: {}, message: 'must not be bad' }] : null,
})
const REGISTRATIONS = {
  one: [whenCheck],
  two: [whenCheck, tagCheck],
  none: [() => null],
}

let seed = 7
// High bits: the low bits of this generator repeat every few calls, which once
// kept whole kinds of document from ever being drawn.
const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) % k }
const pick = (a) => a[rnd(a.length)]
function schemaFor (depth) {
  const properties = {}
  for (const k of ['id', 'when', 'tag', 'items', 'meta'].filter(() => rnd(3) !== 0)) {
    if (k === 'items' && depth > 0) properties[k] = { type: 'array', items: schemaFor(depth - 1) }
    else if (k === 'meta' && depth > 0) properties[k] = schemaFor(depth - 1)
    else if (k === 'id') properties[k] = { type: 'integer', minimum: 1 }
    else if (k === 'tag') properties[k] = { type: 'string', maxLength: 5, ...(rnd(3) === 0 ? { default: 'x' } : {}) }
    else properties[k] = { type: 'object' }
  }
  const s = { type: 'object', properties }
  if (rnd(2) === 0) s.required = Object.keys(properties).slice(0, 1)
  return s
}
function docFor (depth) {
  const o = {}
  if (rnd(3)) o.id = pick([1, 2, 0, 'x'])
  if (rnd(2)) o.when = pick([new Date(0), {}, 'yesterday', new Date(1)])
  if (rnd(3)) o.tag = pick(['ok', 'bad', 'toolongtag', 3])
  if (depth > 0 && rnd(2)) o.items = [docFor(depth - 1), docFor(depth - 1)]
  if (depth > 0 && rnd(3)) o.meta = docFor(depth - 1)
  return o
}
// Dates do not survive JSON, so every document is rebuilt fresh per call.
const fresh = (d) => (d instanceof Date ? new Date(d.getTime()) : Array.isArray(d) ? d.map(fresh) : d && typeof d === 'object' ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, fresh(v)])) : d)
const show = (r) => JSON.stringify(r)

let compared = 0, schemas = 0
const seen = { keywordOnly: 0, both: 0, schemaOnly: 0, valid: 0 }
const diffs = []
for (let i = 0; i < 120; i++) {
  const schema = schemaFor(2)
  const src = compiledModuleFor(schema, { format: 'cjs' })
  if (!src) continue
  schemas++
  const mod = load(src)
  const normalized = compiledSchemaFor(schema)
  for (const [label, regs] of Object.entries(REGISTRATIONS)) {
    const runtime = new Validator(schema)
    const full = fromCompiled(mod, normalized)
    const verdict = fromCompiledVerdict(mod, normalized)
    for (const r of regs) { runtime._extendChecks(r); full._extendChecks(r); verdict._extendChecks(r) }
    for (let j = 0; j < 6; j++) {
      const doc = docFor(2)
      const text = JSON.stringify(doc)
      if (label !== 'none') {
        const plain = new Validator(JSON.parse(JSON.stringify(schema))).isValidObject(fresh(doc))
        const ext = runtime.isValidObject(fresh(doc))
        seen[plain && ext ? 'valid' : plain ? 'keywordOnly' : ext ? 'schemaOnly' : 'both']++
      }
      for (const [name, a, b] of [
        ['validate', () => show(runtime.validate(fresh(doc))), () => show(full.validate(fresh(doc)))],
        ['validate, errors read twice', () => { const r = runtime.validate(fresh(doc)); return show(r.errors) + show(r.errors) }, () => { const r = full.validate(fresh(doc)); return show(r.errors) + show(r.errors) }],
        ['validate, input after', () => { const d = fresh(doc); runtime.validate(d); return show(d) }, () => { const d = fresh(doc); full.validate(d); return show(d) }],
        ['isValidObject', () => String(runtime.isValidObject(fresh(doc))), () => String(full.isValidObject(fresh(doc)))],
        ['validateJSON', () => show(runtime.validateJSON(text)), () => show(full.validateJSON(text))],
        ['isValidJSON', () => String(runtime.isValidJSON(text)), () => String(full.isValidJSON(text))],
        ['verdict isValidObject', () => String(runtime.isValidObject(fresh(doc))), () => String(verdict.isValidObject(fresh(doc)))],
        ['verdict isValidJSON', () => String(runtime.isValidJSON(text)), () => String(verdict.isValidJSON(text))],
        ['verdict, input after', () => { const d = fresh(doc); runtime.isValidObject(d); return show(d) }, () => { const d = fresh(doc); verdict.isValidObject(d); return show(d) }],
      ]) {
        compared++
        const want = a(), got = b()
        if (want !== got) diffs.push(`${label} ${show(schema).slice(0, 160)} on ${text} :: ${name}\n    runtime  ${want.slice(0, 300)}\n    compiled ${got.slice(0, 300)}`)
      }
    }
  }
}

// The wrapper looks like an uncompiled Validator to the keywords package and
// hides that from anything enumerating its methods.
{
  const w = fromCompiled(load(compiledModuleFor({ type: 'object' }, { format: 'cjs' })), { type: 'object' })
  assert.strictEqual(w._initialized, false)
  assert.deepStrictEqual(Object.keys(w).sort(), ['isValidJSON', 'isValidObject', 'validate', 'validateJSON'])
  assert.throws(() => w._extendChecks(null), TypeError)
}
fs.rmSync(dir, { recursive: true, force: true })

if (diffs.length) {
  console.log(`${diffs.length} of ${compared} differ. A sample:\n`)
  for (const d of diffs.slice(0, 8)) console.log(d + '\n')
}
assert.strictEqual(diffs.length, 0, 'the compiled wrappers and the runtime disagree under an extension')
assert.ok(schemas >= 100 && compared > 5000, `compared too little: ${schemas} schemas, ${compared} checks`)
// The cases that matter must all occur: a document only the keyword rejects,
// one the schema and the keyword both reject, and one both accept.
assert.ok(seen.keywordOnly >= 50 && seen.both >= 50 && seen.valid >= 50, `too few cases of each kind: ${JSON.stringify(seen)}`)
console.log(`ok: compiled wrappers answer as the runtime under _extendChecks on ${compared} checks over ${schemas} schemas (${JSON.stringify(seen)})`)
