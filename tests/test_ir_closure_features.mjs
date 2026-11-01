// What the IR's closure backend (lib/ir/run.mjs) takes beyond the module
// writer, held to the current engine on generated documents: errorMessage
// (custom messages over the finished errors), the discriminator (ignored, as
// the Validator ignores it), OpenAPI's nullable, coerceTypes and
// removeAdditional, custom formats, custom keywords. Verdict, every error with every field in order, and the
// document after the passes.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')
const { compile } = await import('../lib/ir/run.mjs')

const CASES = [
  [{ type: 'string', minLength: 3, errorMessage: 'too short' }, {}],
  [{ type: 'object', required: ['a', 'b'], properties: { a: { type: 'integer', minimum: 2, errorMessage: { minimum: 'a too small', type: 'a must be an integer' } }, b: { type: 'string', maxLength: 3 } }, additionalProperties: false, errorMessage: { required: { a: 'need a' }, additionalProperties: 'no extras', _: 'bad object' } }, {}],
  [{ type: 'object', properties: { list: { type: 'array', items: { type: 'number', errorMessage: 'numbers only' } } } }, {}],
  [{ $schema: 'http://json-schema.org/draft-07/schema#', definitions: { p: { type: 'number', errorMessage: 'a number, please' } }, properties: { p: { $ref: '#/definitions/p' }, q: { $ref: '#/definitions/p' } } }, {}],
  [{ type: 'object', discriminator: { propertyName: 'k' }, oneOf: [{ properties: { k: { const: 'a' }, x: { type: 'string' } }, required: ['k'] }, { properties: { k: { const: 'b' }, y: { type: 'number' } }, required: ['k'] }] }, {}],
  [{ type: 'object', properties: { a: { type: 'string', nullable: true, minLength: 2 }, b: { type: 'integer', nullable: true }, c: { enum: ['x', 'y'], nullable: true } } }, {}],
  [{ type: 'object', properties: { n: { type: 'integer', minimum: 1 }, f: { type: 'number' }, b: { type: 'boolean' }, s: { type: 'string' }, inner: { type: 'object', properties: { m: { type: 'integer' } }, additionalProperties: false } }, additionalProperties: false }, { coerceTypes: true, removeAdditional: true }],
  [{ type: 'object', properties: { n: { type: 'integer', default: 3 }, t: { type: 'string', errorMessage: 'text' } }, required: ['t'] }, { coerceTypes: true }],
  // Custom formats: a new name, a built-in name replaced, a non-function ignored.
  [{ type: 'object', properties: { s: { format: 'short' }, a: { type: 'string', format: 'email' }, b: { format: 'email' }, c: { format: 'uuid' } } }, { formats: { short: (v) => v.length < 2, email: (v) => v !== 'x', uuid: /never/ } }],
  [{ type: 'object', properties: { s: { format: 'short' } } }, { formats: { short: () => 0 }, assertFormat: false }],
  // Custom keywords: compile, validate (a bare function too), macro, type
  // lists, errors a function writes (with and without its own paths), the
  // order `before` and `post` give, and keywords under applicators.
  [{ type: 'object', properties: { t: { type: 'string', maxWords: 2 }, n: { range: [1, 5] }, m: { atLeast: 3 }, e: { even: true }, u: { anyOf: [{ maxWords: 1 }, { type: 'number', even: true }] }, v: { not: { even: true } }, w: { if: { type: 'number' }, then: { atLeast: 0 } }, r: { $ref: '#/$defs/r' } }, $defs: { r: { type: ['string', 'number'], tagged: 'x', atLeast: 2, nothing: 1, never: true } } }, { keywords: {
    maxWords: { type: 'string', compile: (n) => (s) => s.split(/\s+/).length <= n },
    range: { macro: ([a, b]) => ({ minimum: a, maximum: b }) },
    atLeast: { type: ['number', 'string'], validate: function check (limit, data) { if ((typeof data === 'string' ? data.length : data) >= limit) return true; check.errors = [{ message: 'must be at least ' + limit, params: { limit }, keyword: 'minimum' }, { message: 'second', instancePath: '/deep', schemaPath: '#/elsewhere' }]; return false } },
    even: (v, d) => typeof d !== 'number' || d % 2 === 0,
    tagged: { type: 'string', before: 'atLeast', validate: (v, d) => d !== 'bad' },
    nothing: { macro: () => undefined },
    never: { macro: (v) => v ? false : true, post: true },
  } }],
  // References that name nothing fail where they run (ATA5001); an $id with a
  // pointer fragment opens no resource; baseURI is the base of a schema
  // without an $id.
  [{ $schema: 'http://json-schema.org/draft-07/schema#', definitions: { e: { $id: '#/definitions/e', type: 'string', minLength: 2 } }, properties: { a: { $ref: '#/definitions/e' }, b: { $ref: 'defs/x.json' }, c: { $ref: '#/nope' }, t: { $ref: '#noanchor' }, x: { $ref: 'https://other.example/y.json#/z' } } }, {}],
  [{ properties: { a: { $ref: 'defs/item.json' }, b: { $ref: 'defs/missing.json' } } }, { baseURI: 'https://ex.com/root.json', schemas: [{ $id: 'https://ex.com/defs/item.json', type: 'string', minLength: 2 }] }],
  // The other values of coerceTypes and removeAdditional, and both with
  // documents registered under relative names (Fastify's `shared`).
  [{ type: 'object', properties: { tags: { type: 'array', items: { type: 'integer' } }, n: { type: 'number' }, o: { type: 'object', properties: { k: { type: 'boolean' } }, additionalProperties: false } }, additionalProperties: false }, { coerceTypes: 'array', removeAdditional: 'failing' }],
  [{ $ref: 'shared#' }, { coerceTypes: true, removeAdditional: 'all', schemas: [{ $id: 'shared', type: 'object', properties: { n: { type: 'integer' }, b: { type: 'boolean' }, t: { type: 'array', items: { type: 'number' } } }, additionalProperties: false }] }],
  [{ type: 'object', properties: { n: { $ref: 'shared#/properties/n' }, x: { type: 'string' }, s: { $ref: 'shared' } } }, { coerceTypes: 'array', schemas: { shared: { $id: 'shared', type: 'object', properties: { n: { type: 'integer' }, t: { type: 'array' } }, required: ['n'] } } }],
  // verbose and abortEarly, rich and plain, alone and together, with errorMessage.
  ...[{ verbose: true }, { verbose: true, richErrors: false }, { abortEarly: true }, { abortEarly: true, richErrors: false }, { abortEarly: true, verbose: true }, { abortEarly: true, verbose: true, richErrors: false }].map((o) => [{ type: 'object', properties: { a: { type: 'string', minLength: 3 }, b: { type: 'integer', errorMessage: 'b is whole' }, c: { anyOf: [{ type: 'string' }, { type: 'number', minimum: 5 }] }, list: { type: 'array', items: { type: 'object', properties: { q: { type: 'number' } }, required: ['q'] } } }, required: ['t', 'x'], additionalProperties: false }, o]),
]

let seed = 7
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const ATOMS = [null, true, false, 0, 1, 2, 1.5, -3, '', 'a', 'ab', 'abcd', '5', '1.5', 'true', 'false', 'x', 'y', 'b', [], {}, [1, 'a']]
const KEYS = ['a', 'b', 'c', 'k', 'x', 'y', 'n', 'f', 's', 't', 'p', 'q', 'm', 'list', 'inner', 'z']
function value (d) {
  const r = rnd(10)
  if (d < 3 && r === 0) { const o = {}; for (let i = rnd(5); i > 0; i--) o[KEYS[rnd(KEYS.length)]] = value(d + 1); return o }
  if (d < 3 && r === 1) { const a = []; for (let i = rnd(4); i > 0; i--) a.push(value(d + 1)); return a }
  return structuredClone(ATOMS[rnd(ATOMS.length)])
}
const shape = (r) => JSON.stringify([r.valid, Object.isFrozen(r), (r.errors || []).map((e) => [Object.isFrozen(e), e._s === true, Object.keys(e).map((k) => [k, e[k] === undefined ? '<undef>' : e[k]])])])
const dump = (d) => { try { return JSON.stringify(d) } catch { return String(d) } }

let failed = 0; let checked = 0
for (const [schema, opts] of CASES) {
  const ata = new Validator(schema, opts)
  const ir = compile(schema, opts)
  for (let i = 0; i < 3000; i++) {
    const doc = rnd(4) === 0 ? value(3) : (() => { const o = {}; for (let j = rnd(6); j > 0; j--) o[KEYS[rnd(KEYS.length)]] = value(1); return o })()
    const a = structuredClone(doc); const b = structuredClone(doc)
    const x = shape(ata.validate(a)) + dump(a); const y = shape(ir.validate(b)) + dump(b)
    checked++
    if (x !== y || ata.isValidObject(structuredClone(doc)) !== ir.isValid(structuredClone(doc))) {
      if (failed++ < 3) console.log('FAIL', dump(schema).slice(0, 90), dump(opts), dump(doc), '\n  current', x.slice(0, 300), '\n  ir     ', y.slice(0, 300))
    }
  }
}
if (failed) { console.log(`${failed} of ${checked} differ`); process.exit(1) }
console.log(`ok: the closure backend matches the current engine on ${checked} documents across errorMessage, discriminator, nullable, coerceTypes, removeAdditional, custom formats, custom keywords, verbose, abortEarly, unresolved references, baseURI, option values and relative schema names`)
