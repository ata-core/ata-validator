// Text in a schema is data wherever it ends up: a property name, an enum
// value, a default, a description, a pattern. Whatever a writer does with it,
// a schema must answer exactly as its twin does, the same schema with each
// such text swapped for a plain one of the same length. Here every writer
// (the generated code behind the Validator, the modules `ata build` writes,
// and ata-validator/ir's module, table, plan and closures) is given the
// schema and its twin, and the two are held to the same verdicts, the same
// errors field for field once the text is swapped back, and the same
// document afterwards (defaults filled).
//
// The texts are the ones that mean something to the tools a writer is made
// of rather than to JavaScript's own syntax, which
// tests/test_schema_code_injection.js and its IR twin cover: the replacement
// patterns of String.prototype.replace ($&, $', $`, $$, $1, $<name>), which
// a writer that assembles source with replace() expands inside the text.
// That is how it was found (2026-11-14): the IR module writer placed the
// schema for the shared defaults pass with replace(), SchemaStore's
// apollo-router schema has "$`" in a description, and the module written for
// it held a copy of its own source in the middle of a string and did not
// parse.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import { compileClosures, tableModule, tablePlan, closureModule } from '../lib/ir/index.mjs'
import { fromPlan } from '../lib/kernels/plan-rich.mjs'
import * as K from '../lib/kernels/index.mjs'

// Generated code from the first call, as in tests/run.js and the gate.
process.env.ATA_NO_SMALL_TWIN = '1'
const require = createRequire(import.meta.url)
const { Validator } = require('..')
const { compiledModuleFor, compiledSchemaFor, toStandaloneModule } = require('../build')
const { fromCompiled } = require('../lib/compiled')

const HOSTILE = [
  // Replacement patterns.
  'a$&b', "a$'b", 'a$`b', 'a$$b', 'a$1b', 'a$<n>b', '$&', "$'", '$`', '$$', "$'$`$&$$",
  // A pattern that copies generated source into a string, and a quote that
  // the copy does not escape: before the fix the text after it ran as code
  // (below, it would set a global).
  `x$\`'+(globalThis.__tw=1)+'`, `x$'"+(globalThis.__tw=1)+"`, `x$\`\`+(globalThis.__tw=1)+\``,
  // Words the writers' own source is made of: a writer that rewrites a piece
  // of generated code by name (a parameter for the value it stands for, a
  // `return false` for a jump) must not rewrite them inside a string.
  'return false', 'return true', 'return 0;', 'return -1;', 'return false;', 'v', 'n', 'd', '_v', '_bv', '_av', 'break', 'isValid', 'FILL', 'errors',
]
// Each stands between two marks that occur nowhere else, so that what a path
// says can be compared after swapping the text for its twin's; a word
// between them is still a word to a writer that looks for one. The twin: the
// same length, none of the characters or words above.
const MARK = '\u00a7'
// A double quote stays one: it is two bytes of JSON text, and validateJSON()
// reports positions in that text.
const twinOf = (t) => MARK + [...t.slice(1, -1)].map((c, i) => c === '"' ? c : i === 0 ? 'q' : 'z').join('') + MARK
const ptr = (t) => t.replace(/~/g, '~0').replace(/\//g, '~1')

// [schema, documents], each a function of the text.
const TEMPLATES = [
  (t) => [{ type: 'object', properties: { [t]: { type: 'string', maxLength: 3 } }, required: [t], additionalProperties: false }, [{ [t]: 'ab' }, { [t]: 'abcd' }, {}, { [t]: 1 }, { other: 1 }, { [t]: 'ab', other: 1 }]],
  (t) => [{ properties: { k: { enum: [t, 1, null] } } }, [{ k: t }, { k: 'zz' }, { k: 1 }, { k: [t] }]],
  (t) => [{ properties: { k: { const: t } } }, [{ k: t }, { k: 1 }]],
  (t) => [{ properties: { k: { const: { [t]: [t] } } } }, [{ k: { [t]: [t] } }, { k: { [t]: [] } }, { k: 1 }]],
  (t) => [{ type: 'object', properties: { k: { type: 'string', default: t }, j: { type: 'integer' } }, required: ['j'] }, [{ j: 1 }, {}, { j: 1, k: 'own' }, { j: 'x' }]],
  (t) => [{ type: 'object', properties: { k: { type: 'object', default: { [t]: t } } } }, [{}, { k: 1 }]],
  (t) => [{ type: 'object', description: t, additionalProperties: { type: 'object', description: t, properties: { x: { default: t } } } }, [{ p: {} }, { p: { x: 1 } }, { p: 1 }, {}]],
  (t) => [{ title: t, description: t, $comment: t, type: 'object', properties: { k: { title: t, description: t, type: 'integer', examples: [t] } } }, [{ k: 1 }, { k: 'x' }]],
  (t) => [{ properties: { [t]: { type: 'string', format: 'email' } } }, [{ [t]: 'a@b.co' }, { [t]: 'nope' }, { [t]: 1 }]],
  (t) => [{ properties: { [t]: { type: 'string', format: 'date-time' }, k: { type: 'string', format: 'uuid' } } }, [{ [t]: '2020-01-01T00:00:00Z' }, { [t]: 'nope', k: 'nope' }]],
  (t) => [{ dependentRequired: { [t]: ['k'] } }, [{ [t]: 1 }, { [t]: 1, k: 1 }, { k: 1 }]],
  (t) => [{ dependentSchemas: { [t]: { required: ['k'], properties: { k: { const: t } } } } }, [{ [t]: 1 }, { [t]: 1, k: t }, { [t]: 1, k: 1 }]],
  (t) => [{ properties: { [t]: { type: 'integer', minimum: 3 } }, patternProperties: { '^zz': { type: 'string' } } }, [{ [t]: 5 }, { [t]: 1 }, { [t]: 'x' }, { zz1: 1, [t]: 5 }]],
  (t) => [{ $defs: { [t]: { type: 'integer' } }, properties: { a: { $ref: '#/$defs/' + ptr(t) } } }, [{ a: 1 }, { a: 'x' }]],
  (t) => [{ type: 'object', properties: { [t]: { type: 'object', properties: { [t]: { type: 'integer' } }, required: [t] } }, required: [t] }, [{ [t]: { [t]: 1 } }, { [t]: { [t]: 'x' } }, { [t]: {} }, {}]],
  (t) => [{ propertyNames: { const: t } }, [{ [t]: 1 }, { q: 1 }, {}]],
  (t) => [{ propertyNames: { enum: [t, 'ok'] } }, [{ [t]: 1, ok: 1 }, { q: 1 }]],
  (t) => [{ type: 'object', required: [t, 'b'], properties: { b: { type: 'integer' } } }, [{ [t]: 1, b: 1 }, { b: 1 }, { [t]: 1 }, { [t]: 1, b: 'x' }]],
  (t) => [{ anyOf: [{ required: [t] }, { properties: { b: { const: t } }, required: ['b'] }] }, [{ [t]: 1 }, { b: t }, { b: 1 }, {}]],
  (t) => [{ oneOf: [{ required: [t] }, { required: ['b'] }] }, [{ [t]: 1 }, { b: 1 }, { [t]: 1, b: 1 }, {}]],
  (t) => [{ type: 'object', properties: { [t]: true }, unevaluatedProperties: false }, [{ [t]: 1 }, { other: 1 }, {}]],
  (t) => [{ if: { properties: { [t]: { const: 1 } }, required: [t] }, then: { required: ['b'] }, else: { required: ['c'] } }, [{ [t]: 1 }, { [t]: 1, b: 1 }, { [t]: 2 }, { [t]: 2, c: 1 }]],
  (t) => [{ type: 'array', items: { type: 'object', required: [t], properties: { [t]: { enum: [t] } } } }, [[{ [t]: t }], [{ [t]: 1 }], [{}], []]],
  (t) => [{ type: 'array', prefixItems: [{ const: t }], items: { type: 'string', enum: [t, 'x'] } }, [[t, t, 'x'], [t, 1], ['x']]],
  (t) => [{ type: 'object', properties: { [t]: { type: 'integer' } }, minProperties: 1, maxProperties: 2 }, [{ [t]: 1 }, {}, { [t]: 1, a: 1, b: 1 }]],
  (t) => [{ type: 'string', enum: [t, "x"] }, [t, "x", 'no', 1]],
  (t) => [{ not: { const: t } }, [t, 'no']],
  (t) => [{ anyOf: [{ type: 'string', enum: [t] }, { type: 'object', required: [t], properties: { [t]: { const: t } } }, { type: 'integer', minimum: 3 }] }, [t, 'no', { [t]: t }, { [t]: 1 }, 5, 1]],
  (t) => [{ oneOf: [{ const: t }, { type: 'object', properties: { [t]: { type: 'string', enum: [t, 'x'] } }, required: [t] }] }, [t, { [t]: 'x' }, { [t]: 'y' }, 1]],
  (t) => [{ type: 'object', properties: { k: { type: 'string', minLength: 1, maxLength: 40, enum: [t, 'x'] }, [t]: { type: 'number', minimum: 1, maximum: 9, multipleOf: 2 } } }, [{ k: t, [t]: 2 }, { k: 'no', [t]: 3 }, { [t]: 10 }, { [t]: 'x' }]],
  (t) => [{ type: 'object', properties: { [t]: { type: 'string', format: 'email', minLength: 3 } }, required: [t], additionalProperties: { type: 'string', format: 'date' } }, [{ [t]: 'a@b.co', x: '2020-01-01' }, { [t]: 'no', x: 'no' }, {}]],
  (t) => [{ allOf: [{ properties: { [t]: { type: 'string', format: 'ipv4' } } }, { if: { required: [t] }, then: { properties: { k: { const: t } } } }] }, [{ [t]: '1.2.3.4', k: t }, { [t]: 'no', k: 1 }, { k: 1 }]],
  (t) => [{ type: 'object', properties: { n: { type: 'number', minimum: 1 }, [t]: { type: 'array', items: { type: 'number' }, minItems: 1, uniqueItems: true } }, required: ['n'] }, [{ n: 1, [t]: [1, 2] }, { n: 0, [t]: [1, 1] }, { [t]: [] }, { n: 1, [t]: ['x'] }]],
]

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-twin-'))
let files = 0
const loadCjs = (src) => { const f = path.join(dir, `m${files++}.cjs`); fs.writeFileSync(f, src); return require(f) }
const loadData = (t) => { const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(t); return new Function('K', `const {${m[1]}}=K\n` + t.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + '\nreturn{isValid,validate}')(K) }
const viaValidator = (opts, m) => (s) => { const v = new Validator(structuredClone(s), opts); return (d) => { const r = v[m](m.endsWith('JSON') ? JSON.stringify(d) : d); return typeof r === 'object' && r !== null ? { valid: r.valid, errors: r.errors } : r } }
const mod = (m) => m === null ? null : (d) => ({ verdict: m.isValid(structuredClone(d)), result: m.validate(d) })

// A path builds an answering function from a schema, or returns null where
// it declines the schema.
const PATHS = {
  'validate()': viaValidator(undefined, 'validate'),
  'isValidObject()': viaValidator(undefined, 'isValidObject'),
  'validateJSON()': viaValidator(undefined, 'validateJSON'),
  'isValidJSON()': viaValidator(undefined, 'isValidJSON'),
  'validate(), plain errors': viaValidator({ richErrors: false }, 'validate'),
  'validate(), first error': viaValidator({ allErrors: false }, 'validate'),
  'interpreted engine': viaValidator({ engine: 'interpreter' }, 'validate'),
  'compiled module': (s) => { const src = compiledModuleFor(structuredClone(s), { format: 'cjs' }); if (!src) return null; const v = fromCompiled(loadCjs(src), compiledSchemaFor(structuredClone(s))); return (d) => v.validate(d) },
  'standalone module': (s) => { const src = toStandaloneModule(structuredClone(s), { format: 'cjs' }); if (!src) return null; const m = loadCjs(src); const f = m.validate || m.default || m; return typeof f === 'function' ? (d) => f(d) : null },
  'ir module': (s) => mod(new Function('K', functionBody(specialize(structuredClone(s), { verdict: true })))(K)),
  'ir module, no verdict function': (s) => mod(new Function('K', functionBody(specialize(structuredClone(s), {})))(K)),
  'ir module, plain errors': (s) => mod(new Function('K', functionBody(specialize(structuredClone(s), { verdict: true, richErrors: false })))(K)),
  'ir closures': (s) => mod(compileClosures(structuredClone(s), {})),
  'ir table': (s) => { const t = tableModule(structuredClone(s), {}); return t === null ? null : mod(loadData(t)) },
  'ir plan': (s) => { const p = tablePlan(structuredClone(s), {}); return p === null ? null : mod(fromPlan(JSON.parse(JSON.stringify(p)))) },
  'ir closure module': (s) => { const t = closureModule(structuredClone(s), { richErrors: false }); return t === null ? null : mod(loadData(t)) },
}

// What a path said for a document, with the text swapped for its twin's so
// the two can be compared as they stand.
const said = (answer, d, t, twin) => {
  const doc = structuredClone(d)
  let out
  try { out = answer(doc) } catch (e) { out = { threw: String(e && e.message) } }
  // In every string and key: the text as it stands, and as it reads inside a
  // preview of the document, which is JSON within a string.
  const quoted = JSON.stringify(t).slice(1, -1)
  const swap = (x) => typeof x !== 'string' ? x : x.split(t).join(twin).split(quoted).join(twin)
  const walk = (x) => Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [swap(k), walk(v)])) : swap(x)
  return JSON.stringify(walk({ out, doc }))
}

const count = {}; const declined = {}; const differ = []
for (const core of HOSTILE) {
  const t = MARK + core + MARK
  const twin = twinOf(t)
  for (let i = 0; i < TEMPLATES.length; i++) {
    const [schema, docs] = TEMPLATES[i](t)
    const [twinSchema, twinDocs] = TEMPLATES[i](twin)
    for (const [name, build] of Object.entries(PATHS)) {
      const make = (s) => { try { return build(s) } catch (e) { return { refused: String(e && e.message).split(t).join(twin) } } }
      const a = make(schema); const b = make(twinSchema)
      const label = `${name}, template ${i}, text ${JSON.stringify(t)}`
      if (a === null || b === null || typeof a !== 'function' || typeof b !== 'function') {
        // Declined or refused, then both, and for the same reason. A path may
        // also decline the schema alone (the module writers decline a
        // definition whose name holds a quote): declining is never wrong.
        if (a === null && typeof b === 'function') { declined[name] = (declined[name] || 0) + 1; continue }
        const same = (a === null && b === null) || (a && b && typeof a !== 'function' && typeof b !== 'function' && a.refused === b.refused)
        if (!same) differ.push(`${label}: the schema ${typeof a === 'function' ? 'is taken' : a === null ? 'is declined' : 'is refused (' + a.refused.slice(0, 120) + ')'}, its twin ${typeof b === 'function' ? 'is taken' : b === null ? 'is declined' : 'is refused (' + b.refused.slice(0, 120) + ')'}`)
        continue
      }
      count[name] = (count[name] || 0) + 1
      for (let j = 0; j < docs.length; j++) {
        const x = said(a, docs[j], t, twin); const y = said(b, twinDocs[j], twin, twin)
        if (x !== y) differ.push(`${label}, document ${JSON.stringify(docs[j])}\n      schema ${x.slice(Math.max(0, [...x].findIndex((c, k) => c !== y[k]) - 80)).slice(0, 300)}\n      twin   ${y.slice(Math.max(0, [...x].findIndex((c, k) => c !== y[k]) - 80)).slice(0, 300)}`)
      }
    }
  }
}
fs.rmSync(dir, { recursive: true, force: true })

if (process.env.ATA_TWIN_ALL) fs.writeFileSync(process.env.ATA_TWIN_ALL, differ.join('\n'))
if (differ.length) {
  console.log(differ.slice(0, 40).join('\n'))
  if (differ.length > 40) console.log(`... and ${differ.length - 40} more`)
}
assert.strictEqual(differ.length, 0, `${differ.length} answers differ between a schema and its twin`)
assert.strictEqual(globalThis.__tw, undefined, 'text from a schema ran as code')
// It proves something only where the paths took the schemas.
const total = HOSTILE.length * TEMPLATES.length
for (const k of Object.keys(PATHS)) assert.ok((count[k] || 0) >= (k === 'ir closure module' ? total / 5 : k.startsWith('ir table') || k === 'ir plan' ? total / 2 : total * 0.8), `${k} took ${count[k] || 0} of ${total} schemas`)
console.log(`ok: a schema answers as its twin does through ${Object.keys(PATHS).length} paths, ${total} schemas (taken ${JSON.stringify(count)}, declined alone ${JSON.stringify(declined)})`)
