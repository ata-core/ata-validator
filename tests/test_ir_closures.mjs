// The closure backend (lib/ir/closures.mjs, run by lib/kernels/closures.mjs)
// against the module writer (lib/ir/emit.mjs), which the IR's other tests
// hold to the current engine: verdicts and every error field in order, plain
// errors, on every group of the official suite it takes, in every dialect,
// on forms, and on values JSON cannot hold. A schema it refuses returns null
// and is counted, never guessed.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { closureModule } from '../lib/ir/closures.mjs'
import * as K from '../lib/kernels/index.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SUITE = path.join(here, 'suite/tests')
const load = (src) => { const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(src); return new Function('K', `const {${m[1]}}=K\n` + src.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + 'return{isValid,validate}')(K) }
const loadModule = (src) => new Function('K', functionBody(src))(K)
const FIELDS = ['code', 'keyword', 'instancePath', 'schemaPath', 'params', 'message', 'docUrl']
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => FIELDS.map((f) => e[f] === undefined ? '<undef>' : e[f]))])

let groups = 0; let taken = 0; let cases = 0; let sorted = 0
function compare (schema, docs, label, opts = {}) {
  const src = closureModule(schema, { richErrors: false, useDefaults: false, ...opts })
  if (src === null) return false
  let m
  try { m = loadModule(specialize(schema, { verdict: true, richErrors: false, useDefaults: false, ...opts })) } catch { return false }
  if (src.includes('ordered(')) sorted++
  const c = load(src)
  for (const d of docs) {
    const where = `${label}: ${JSON.stringify(d) === undefined ? String(d) : JSON.stringify(d).slice(0, 120)}`
    assert.strictEqual(shape(c.validate(d)), shape(m.validate(d)), where)
    assert.strictEqual(c.isValid(d), m.isValid(d), where + ': verdict')
    cases++
  }
  return true
}

for (const dialect of fs.readdirSync(SUITE)) {
  for (const sub of ['', 'optional/format']) {
    const dir = path.join(SUITE, dialect, sub)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        groups++
        if (JSON.stringify(g.schema).includes('localhost:1234')) continue
        if (compare(g.schema, g.tests.map((t) => t.data), `${dialect}/${sub}${f}: ${g.description}`)) taken++
      }
    }
  }
}

// Forms, with their keywords in several orders: the errors follow the
// schema's order, and an array of leaves reports check by check.
const leafs = {
  email: { type: 'string', format: 'email', maxLength: 12 },
  name: { minLength: 2, type: 'string', maxLength: 6, pattern: '^[a-z]+$' },
  age: { type: 'integer', maximum: 120, minimum: 13 },
  price: { exclusiveMinimum: 0, type: 'number', multipleOf: 0.5, exclusiveMaximum: 100 },
  country: { enum: ['TR', 'US', 1, null, true] },
  kind: { type: 'string', const: 'a' },
  terms: { type: 'boolean' },
  nothing: { type: 'null' },
  either: { type: ['string', 'null'], minLength: 3 },
  tags: { type: 'array', items: { type: 'string', maxLength: 3, pattern: '^[a-z]*$' }, maxItems: 3, minItems: 1, uniqueItems: true },
  open: { items: { minimum: 2 }, uniqueItems: true },
  constructor: { type: 'string' },
  'a/b~c': { type: 'integer' },
  address: { required: ['street', 'city'], type: 'object', properties: { street: { type: 'string', minLength: 1 }, city: { type: 'string' }, zip: { pattern: '^[0-9]{5}$' } } },
  rows: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer', minimum: 1 }, s: { type: 'string', minLength: 2 } }, required: ['n'] } },
  grid: { items: { items: { type: 'integer', minimum: 0 } } },
}
const names = Object.keys(leafs)
const good = { email: 'a@b.co', name: 'ann', age: 30, price: 2.5, country: 'TR', kind: 'a', terms: true, nothing: null, either: null, tags: ['a', 'b'], open: [2, 3], constructor: 'x', 'a/b~c': 1, address: { street: 'x', city: 'y', zip: '12345' }, rows: [{ n: 1, s: 'ab' }], grid: [[1], [2, 3]] }
const bad = { email: 'not an email at all', name: 'A', age: 7.5, price: -0.3, country: 'ZZ', kind: 'b', terms: 'yes', nothing: 0, either: 'ab', tags: ['TOOLONG', 1, 'ok', 'TOOLONG', '1'], open: [1, 1, 'x'], constructor: 1, 'a/b~c': 'x', address: { street: '', zip: 'x' }, rows: [{ n: 0, s: 'a' }, { s: 1 }, 5], grid: [[-1, 'x'], 'no', [-2]] }
const docs = [{}, good, bad, null, 1, 'x', [], [good]]
for (const k of names) { docs.push({ ...good, [k]: bad[k] }); const d = { ...good }; delete d[k]; docs.push(d); docs.push({ ...bad, [k]: good[k] }) }
docs.push({ ...good, extra: 1, more: 2 }, { ...bad, extra: 1 })
docs.push(Object.defineProperty({ ...good }, 'email', { value: 1, enumerable: false }), Object.create(good), Object.assign(Object.create({ extra: 1 }), good), Object.assign(Object.create(null), bad), { ...good, email: undefined }, JSON.parse('{"__proto__": 1, "email": "a@b.co"}'), { ...good, age: NaN, price: Infinity }, { ...good, tags: [undefined, 'a'] })
let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const forms = []
for (let i = 0; i < 60; i++) {
  const pick = names.filter(() => rnd() < 0.5); const req = [...pick, 'missing'].filter(() => rnd() < 0.4)
  if (rnd() < 0.5) req.reverse()
  const parts = [['type', 'object'], ['properties', Object.fromEntries(pick.map((k) => [k, leafs[k]]))], ['required', req], ['additionalProperties', rnd() < 0.5 ? false : true]].filter(() => rnd() < 0.85)
  for (let j = parts.length - 1; j > 0; j--) { const x = Math.floor(rnd() * (j + 1)); [parts[j], parts[x]] = [parts[x], parts[j]] }
  forms.push(Object.fromEntries(parts))
}
for (const k of names) forms.push(leafs[k])
let formsTaken = 0
for (const [i, s] of forms.entries()) if (compare(s, docs, 'form ' + i)) formsTaken++
assert.strictEqual(formsTaken, forms.length, `${forms.length - formsTaken} forms refused`)
assert.ok(compare(leafs.email, ['a@b.co', 'x'], 'assertFormat: false', { assertFormat: false }))
// An array of leaves is in schema order without the sort.
assert.ok(!closureModule({ properties: { tags: leafs.tags } }, { richErrors: false }).includes('ordered'), 'a leaf loop sorts')
assert.ok(compare({ properties: { tags: leafs.tags, open: leafs.open }, required: ['tags'] }, docs, 'leaf loops'))

// What it must refuse rather than write.
for (const s of [{ anyOf: [{ type: 'string' }] }, { $ref: '#/$defs/a', $defs: { a: {} } }, { properties: { a: { default: 1 } }, patternProperties: { x: {} } }, { additionalProperties: { type: 'string' } }, { enum: [{ a: 1 }] }, { not: {} }, { minProperties: 1 }, { prefixItems: [{}] }]) {
  assert.strictEqual(closureModule(s, { richErrors: false }), null, 'refuses ' + JSON.stringify(s))
}
assert.strictEqual(closureModule({ type: 'string' }, {}), null, 'rich errors are refused')
assert.strictEqual(closureModule({ properties: { a: { default: 1 } } }, { richErrors: false }), null, 'a default to fill is refused')
assert.strictEqual(closureModule({ type: 'string' }, { richErrors: false, coerceTypes: true }), null, 'another option is refused')

assert.ok(taken > 300, `the suite: ${taken} of ${groups} groups taken`)
assert.ok(sorted > 0, 'no module sorted: the fallback went unused')
console.log(`ok: the closure backend answers as the module writer on ${cases} documents: ${taken} of ${groups} suite groups, ${forms.length} forms (${sorted} modules sort)`)
