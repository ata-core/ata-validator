// The table backend (lib/ir/table.mjs, run by lib/kernels/table.mjs) against
// the module writer (lib/ir/emit.mjs), which the IR's other tests hold to the
// current engine: on every group of the official suite the table takes, in
// every dialect, and on SchemaStore-like documents of a few form schemas,
// rich and plain, verdicts, every error field in order, and the document
// after defaults are filled. A schema the table refuses returns null and is
// counted, never guessed.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { tableModule } from '../lib/ir/table.mjs'
import * as K from '../lib/kernels/index.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SUITE = path.join(here, 'suite/tests')
const loadTable = (src) => { const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(src); return new Function('K', `const {${m[1]}}=K\n` + src.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + 'return{isValid,validate}')(K) }
const loadModule = (src) => new Function('K', functionBody(src))(K)
const FIELDS = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'expected', 'received', 'detail', 'suggestion', 'related', 'rank', 'docUrl']
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => FIELDS.map((f) => e[f] === undefined ? '<undef>' : e[f]))])

let groups = 0; let taken = 0; let cases = 0
function compare (schema, docs, label) {
  for (const rich of [true, false]) for (const useDefaults of [true, false]) {
    const t = tableModule(schema, { richErrors: rich, useDefaults })
    if (t === null) return false
    let m
    try { m = loadModule(specialize(schema, { verdict: true, richErrors: rich, useDefaults })) } catch { return false }
    const tb = loadTable(t)
    for (const d of docs) {
      const a = structuredClone(d); const b = structuredClone(d); const c = structuredClone(d); const g = structuredClone(d)
      assert.strictEqual(shape(tb.validate(b)), shape(m.validate(a)), `${label} (${rich ? 'rich' : 'plain'}): ${JSON.stringify(d).slice(0, 120)}`)
      assert.strictEqual(tb.isValid(g), m.isValid(c), `${label}: verdict`)
      assert.strictEqual(JSON.stringify(b), JSON.stringify(a), `${label}: the filled document`)
      cases++
    }
  }
  return true
}

for (const dialect of fs.readdirSync(SUITE)) {
  const dir = path.join(SUITE, dialect)
  if (!fs.statSync(dir).isDirectory()) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      groups++
      if (JSON.stringify(g.schema).includes('localhost:1234')) continue
      if (compare(g.schema, g.tests.map((t) => t.data), `${dialect}/${f}: ${g.description}`)) taken++
    }
  }
}

// Forms: the shapes the table is for, with defaults, nested objects, arrays.
const FORMS = [
  { type: 'object', properties: { email: { type: 'string', format: 'email' }, name: { type: 'string', minLength: 2, maxLength: 80 }, quantity: { type: 'integer', minimum: 1, maximum: 20 }, coupon: { type: ['string', 'null'], pattern: '^[A-Z0-9]{6}$' }, gift: { type: 'boolean', default: false }, note: { type: 'string', maxLength: 280 } }, required: ['email', 'name', 'quantity'], additionalProperties: false },
  { type: 'object', properties: { address: { type: 'object', properties: { street: { type: 'string', minLength: 1 }, zip: { type: 'string', pattern: '^[0-9]{5}$' }, country: { enum: ['TR', 'DE', 'US'], default: 'TR' } }, required: ['street', 'zip'] }, tags: { type: 'array', items: { type: 'string', maxLength: 10 }, maxItems: 3, uniqueItems: true } }, required: ['address'] },
  { $defs: { line: { type: 'string', minLength: 2 } }, type: 'object', properties: { a: { $ref: '#/$defs/line' }, b: { allOf: [{ $ref: '#/$defs/line' }, { maxLength: 5 }] }, c: { not: { const: 'x' } }, d: { if: { type: 'string' }, then: { minLength: 3 }, else: { type: 'number' } } }, dependentRequired: { a: ['b'] } },
]
const DOCS = [{}, { email: 'x@y.co', name: 'Ada', quantity: 3 }, { email: 'bad', name: 'A', quantity: 99, coupon: 'x', extra: 1 }, { address: { street: '', zip: '1', country: 'XX' }, tags: ['a', 'a', 'b', 'c'] }, { address: {} }, { a: 'x', b: 'toolong', c: 'x', d: 'ab' }, { a: 'xy', d: 5 }, { d: true }, null, [], 'str', 42, { address: { street: 's', zip: '12345' } }]
for (const [i, s] of FORMS.entries()) assert.ok(compare(s, DOCS, 'form ' + i), `form ${i}: the table refused it`)

// Coverage must not shrink unnoticed.
assert.ok(taken >= 1300, `the table took ${taken} suite groups`)
console.log(`ok: the table backend answers as the module writer on ${taken} of ${groups} suite groups and ${FORMS.length} forms (${cases} cases)`)
