// The IR writers turn a schema into a module, a table or closures
// (ata-validator/ir, which the bundler plugin uses on an application's
// schemas). Text in a schema must not become code there either. Each writer
// gets schemas whose strings are built to leave a literal, and numeric
// keywords given as strings shaped to read as an expression; each payload,
// if it ran, sets a global. Every module that is written is loaded and run.
//
// Found by a security audit, 2026-11-11: the module writer wrote `minLength`
// and `maxLength` into the module as they stood, so a string there was
// source (`d.length>=Infinity||(...)` ran what the string said). The CommonJS
// generators were tested for this (tests/test_schema_code_injection.js); the
// IR writers were not.
import assert from 'node:assert'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import * as irApi from '../lib/ir/index.mjs'
const { compileClosures, tableModule, tablePlan } = irApi
// The closure module writer came after 1.63.1; it is tested where it exists.
const closureModule = typeof irApi.closureModule === 'function' ? irApi.closureModule : () => null
import { fromPlan } from '../lib/kernels/plan-rich.mjs'
import * as K from '../lib/kernels/index.mjs'

const MARK = '__ataInjected'
const set = `globalThis.${MARK}=1`
const hit = () => { const h = globalThis[MARK] !== undefined; delete globalThis[MARK]; return h }
const loadData = (t) => { const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(t); return new Function('K', `const {${m[1]}}=K\n` + t.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + '\nreturn{isValid,validate}')(K) }

const NUMERIC = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains']
const NUMERIC_PAYLOADS = [`0||(${set})`, `Infinity||(${set})`, `1);${set};(1`, `-1||(${set})`, `1e9||(${set})`, '5']
const STRINGS = [`'+(${set})+'`, `"+(${set})+"`, `\`+(${set})+\``, `\${${set}}`, `*/${set};/*`, `\n${set}//`, ` ${set}//`, `')};${set};({'`, `x',y:${set},z:'`, `"]);${set};(["`, '__proto__', 'constructor']
const leafFor = (kw, p) => { const t = /Length/.test(kw) ? 'string' : /Items|Contains/.test(kw) ? 'array' : /Properties/.test(kw) ? 'object' : 'number'; const l = { type: t, [kw]: p }; if (/Contains/.test(kw)) l.contains = { type: 'number' }; return l }
const docs = () => [5, 1.5, '', 'abc', 'x'.repeat(40), [1, 2], [], { a: 1, b: 2 }, { a: 5 }, { a: 'abc' }, { k: 'abc' }, { k: 1 }, null, [5, 'abc']]

const schemas = []
for (const kw of NUMERIC) for (const p of NUMERIC_PAYLOADS) { const l = leafFor(kw, p); schemas.push(l, { type: 'object', properties: { a: l } }, { type: 'array', items: l }, { $defs: { n: l }, properties: { a: { $ref: '#/$defs/n' } } }) }
for (const p of STRINGS) {
  schemas.push(
    { type: 'object', properties: { [p]: { type: 'string', maxLength: 3 } }, required: [p], additionalProperties: false },
    { properties: { k: { enum: [p, 1, null] } } }, { properties: { k: { const: p } } }, { properties: { k: { const: { [p]: p } } } },
    { properties: { k: { type: 'string', default: p } } }, { title: p, description: p, properties: { k: { title: p, type: 'integer' } } },
    { dependentRequired: { [p]: ['k'] } }, { propertyNames: { const: p } }, { properties: { k: { type: 'string', format: p } } },
    { properties: { k: { type: p } } }, { type: p }, { type: ['string', p] }, { items: { type: p } }, { anyOf: [{ type: p, title: p }, { type: 'string', title: p }] },
    { patternProperties: { '^x': { required: [p] } } }, { items: { required: [p], properties: { [p]: { const: p } } } },
  )
}

const count = { module: 0, 'module plain': 0, closures: 0, table: 0, plan: 0, 'closure module': 0, refused: 0 }
const use = (m) => { for (const d of docs()) { m.isValid(d); const r = m.validate(d); if (r.errors) for (const e of r.errors) void `${e.message} ${e.instancePath} ${e.schemaPath} ${JSON.stringify(e.params)}` } }
const tryPath = async (name, label, build) => {
  let m
  try { m = await build() } catch (e) { count.refused++; assert.ok(!hit(), `${name} ran schema text while refusing: ${label}`); return }
  assert.ok(!hit(), `${name} ran schema text while writing: ${label}`)
  if (m === null) { count.refused++; return }
  try { use(m) } catch { /* a module that throws on a document has still not run schema text, checked below */ }
  assert.ok(!hit(), `${name} ran schema text on a document: ${label}`)
  count[name]++
}
for (const s of schemas) {
  const label = JSON.stringify(s).slice(0, 160)
  await tryPath('module', label, () => new Function('K', functionBody(specialize(s, { verdict: true })))(K))
  await tryPath('module plain', label, () => new Function('K', functionBody(specialize(s, { verdict: true, richErrors: false })))(K))
  await tryPath('closures', label, () => compileClosures(s, {}))
  await tryPath('table', label, () => { const t = tableModule(s, {}); return t === null ? null : loadData(t) })
  await tryPath('plan', label, async () => { const p = tablePlan(s, {}); return p === null ? null : fromPlan(JSON.parse(JSON.stringify(p))) })
  await tryPath('closure module', label, () => { const t = closureModule(s, { richErrors: false }); return t === null ? null : loadData(t) })
}

// The case as found: the string is refused, not written.
assert.throws(() => specialize({ type: 'string', minLength: `Infinity||(${set})` }, {}), /minLength is not a number/)
assert.throws(() => specialize({ type: 'string', maxLength: `0||(${set})` }, {}), /maxLength is not a number/)
assert.ok(!hit())
// The test proves something only where the writers took schemas.
for (const k of ['module', 'module plain', 'closures']) assert.ok(count[k] >= 150, `${k} took ${count[k]} schemas`)
assert.ok(count.table + count.plan + count['closure module'] >= 100, JSON.stringify(count))
console.log(`ok: no schema string ran as code in the IR writers (${JSON.stringify(count)})`)
