'use strict'

// An object whose prototype carries enumerable keys, a class instance or one
// made with Object.create, is validated on its own keys by both engines. The
// generated code walks keys with for...in, which visits inherited ones too;
// it used to reject such objects where additionalProperties is false and,
// under `not`, accept what the interpreter rejects. Every object datum of the
// official suite (2020-12 and draft-07) is rebuilt with such a prototype: an
// unknown inherited key, and each property name the schema uses, as 1, 'x'
// and {}. Verdicts and error lists must match the interpreter.
//
// Not covered: a polluted Object.prototype. An ordinary object's prototype is
// taken as clean by the generated code, as it is by the default validator;
// the interpreter reads own keys only and answers differently there.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { Validator } = require('..')
const root = path.join(__dirname, 'suite/tests')
const names = (s, out) => { if (s && typeof s === 'object') { for (const k of ['properties', 'patternProperties', 'dependentRequired', 'dependentSchemas', 'dependencies']) if (s[k] && typeof s[k] === 'object') for (const n of Object.keys(s[k])) if (!n.startsWith('^')) out.add(n); if (Array.isArray(s.required)) for (const n of s.required) out.add(n); for (const v of Object.values(s)) names(v, out) } return out }
const variants = (d, keys) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return []
  const mk = (proto) => Object.assign(Object.create(proto), d)
  const out = [mk({ zzInherited: 1 })]
  for (const k of keys) if (!Object.hasOwn(d, k)) { out.push(mk({ [k]: 1 }), mk({ [k]: 'x' }), mk({ [k]: {} })) }
  class C { constructor () { Object.assign(this, d) } }
  C.prototype.zzProto = 2
  out.push(new C())
  return out
}
let n = 0; const bad = []
for (const dia of ['draft2020-12', 'draft7']) {
  for (const f of fs.readdirSync(path.join(root, dia)).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(root, dia, f), 'utf8'))) {
      const schema = g.schema && typeof g.schema === 'object' && !('$schema' in g.schema) ? { ...g.schema, $schema: dia === 'draft7' ? 'http://json-schema.org/draft-07/schema#' : 'https://json-schema.org/draft/2020-12/schema' } : g.schema
      let code, interp
      try { code = new Validator(schema); interp = new Validator(schema, { engine: 'interpreter' }); code.isValidObject({}) } catch { continue }
      if (code.engine() !== 'codegen') continue
      const keys = [...names(schema, new Set())].slice(0, 6)
      for (const t of g.tests) for (const d of variants(t.data, keys)) {
        n++
        const want = interp.validate(d)
        const a = code.isValidObject(d), b = code.validate(d)
        const tag = `${dia}/${f} | ${g.description} | ${JSON.stringify(d)} over ${JSON.stringify(Object.getPrototypeOf(d))}`
        if (a !== want.valid || b.valid !== want.valid) { bad.push(`verdict ${a}/${b.valid}, interpreter ${want.valid}: ${tag}`); continue }
        if (!want.valid && JSON.stringify(b.errors.map((e) => [e.keyword, e.instancePath, e.schemaPath])) !== JSON.stringify(want.errors.map((e) => [e.keyword, e.instancePath, e.schemaPath]))) bad.push(`errors: ${tag}`)
      }
    }
  }
}
assert.ok(n > 2500, `too few variants: ${n}`)
assert.deepStrictEqual(bad.slice(0, 5), [], `${bad.length} of ${n} differ`)
console.log(`ok: ${n} objects with enumerable prototype keys answer as the interpreter, verdicts and errors`)
