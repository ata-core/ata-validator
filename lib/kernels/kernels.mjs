// One definition per keyword. The check, its params, its message and
// its enrichment live together, and both IR backends (lib/ir/run.mjs
// and lib/ir/emit.mjs) read this one definition.
//
// A leaf kernel:
//   code              the public error code (a function of the value for format)
//   on(v)             the instance types the keyword constrains; others pass
//   ok(v, n)          the check. One expression over v, n and exported helpers:
//                     the specializer writes its source in with n replaced by
//                     the schema's value, so there is no second copy of it.
//   prepare(n)        optional: the value ok() receives, built once
//   params, msg, exp  functions of the schema value only: evaluated at build
//   rank, detail, suggest   the enrichment; detail and suggest are named
//                     exports, so a module imports only the ones it uses.

import { cpLen, nearest, isObj, typeName, MISSING } from './rt.mjs'
import uq from '../unique-items.js'
import { repr } from './rt.mjs'

// JSON equality and the duplicate search, the functions every engine shares.
export const deq = /* @__PURE__ */ (() => uq._deq)()
export const dupPair = /* @__PURE__ */ (() => uq.duplicatePair)()

export const isStr = (v) => typeof v === 'string'
export const isNum = (v) => typeof v === 'number'

// One predicate per JSON type. isType reads this table, and the specializer
// writes a type's own predicate in place, so both use the same definition.
export const TYPES = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
}
export const isType = (v, t) => { const f = TYPES[t]; return f !== undefined && f(v) }
export const isTypes = (v, ts) => { for (let i = 0; i < ts.length; i++) if (isType(v, ts[i])) return true; return false }

export const typeDetail = (received, v, p) => `expected ${p.type}, found ${typeName(v, received)}`
export const typeSuggest = (v, p) => {
  if (typeof v !== 'string') return null
  const t = p.type
  let ok = false; let what
  if (t === 'integer') { ok = /^-?\d+$/.test(v); what = 'an integer' } else if (t === 'number') { ok = /^-?\d+(\.\d+)?$/.test(v); what = 'a number' } else if (t === 'boolean') { ok = v === 'true' || v === 'false'; what = 'a boolean' }
  return ok ? { text: 'value would coerce; enable `coerceTypes` or pass ' + what, kind: 'coercion' } : null
}
export const type = {
  code: 'ATA1001', on: null,
  ok: (v, n) => typeof n === 'string' ? isType(v, n) : isTypes(v, n),
  params: (n) => ({ type: n }), msg: (n) => `must be ${typeof n === 'string' ? n : n.join(', ')}`, exp: (n) => String(n),
  rank: 1, detail: typeDetail, suggest: typeSuggest,
}

export const minLength = {
  code: 'ATA2001', on: isStr, ok: (v, n) => cpLen(v) >= n,
  params: (n) => ({ limit: n }), msg: (n) => `must NOT have fewer than ${n} characters`, exp: (n) => `string with ≥${n} chars`, rank: 2,
}
export const maxLength = {
  code: 'ATA2002', on: isStr, ok: (v, n) => cpLen(v) <= n,
  params: (n) => ({ limit: n }), msg: (n) => `must NOT have more than ${n} characters`, exp: (n) => `string with ≤${n} chars`, rank: 2,
}
export const minimum = {
  code: 'ATA2003', on: isNum, ok: (v, n) => !(v < n),
  params: (n) => ({ comparison: '>=', limit: n }), msg: (n) => `must be >= ${n}`, exp: (n) => `≥${n}`, rank: 2,
}
export const maximum = {
  code: 'ATA2004', on: isNum, ok: (v, n) => !(v > n),
  params: (n) => ({ comparison: '<=', limit: n }), msg: (n) => `must be <= ${n}`, exp: (n) => `≤${n}`, rank: 2,
}
export const pattern = {
  code: 'ATA2013', on: isStr, ok: (v, n) => n.test(v), prepare: (n) => new RegExp(n, 'u'),
  params: (n) => ({ pattern: n }), msg: (n) => `must match pattern "${n}"`, exp: (n) => `string matching /${n}/`, rank: 2,
}

// Formats are the current engine's own: its run-time checks (lib/formats.js
// formatChecks), its codes (lib/error-codes.js codeFor) and its hints
// (lib/suggestions.js; generated code carries only its format's hint, see lib/ir/emit.mjs). The generated code is its code generator's
// (FORMAT_CODEGEN, written in by ir/emit.mjs). A format it does not know is
// not checked, as there.
import formats from '../formats.js'
import errorCodes from '../error-codes.js'
import suggestions from '../suggestions.js'
const formatCheck = (n) => { const fc = formats.formatChecks(); return Object.prototype.hasOwnProperty.call(fc, n) ? fc[n] : null }
// A named function: generated code imports it by its name.
export function formatSuggest (v, p) { return suggestions.suggestFormat(p.format, v) }
export const formatDetail = (received, v, p) => `not a valid ${p.format}: ${received}`
export const format = {
  code: (n) => errorCodes.codeFor('format', n), on: isStr, ok: (v, n) => n(v),
  // null: a format the current engine does not know, which it does not check.
  prepare: (n) => formatCheck(n),
  params: (n) => ({ format: n }), msg: (n) => `must match format "${n}"`, exp: (n) => `format '${n}'`, rank: 2,
  detail: formatDetail,
  suggest: formatSuggest,
}
export const makeHintSuggest = (hint) => (v) => { if (typeof v !== 'string') return null; const t = hint(v); return t ? { text: t, kind: 'format' } : null }

// Structural kernels: their errors name the container, not a child.
export const requiredDetail = (received, v, p) => `missing required property "${p.missingProperty}"`
export const requiredSuggest = (v, p) => {
  if (v === MISSING || !v || typeof v !== 'object') return null
  const keys = Object.keys(v)
  if (keys.length > 64) return null
  const best = nearest(p.missingProperty, keys)
  return best === null ? null : { text: `did you mean \`${p.missingProperty}\` instead of \`${best}\`?`, kind: 'similar-key' }
}
export const required = {
  code: 'ATA7001', rank: 0,
  params: (k) => ({ missingProperty: k }), msg: (k) => `must have required property '${k}'`, exp: (k) => `property '${k}'`,
  detail: requiredDetail, suggest: requiredSuggest,
}

export const additionalDetail = (received, v, p) => `unknown property "${p.additionalProperty}"`
export const additionalProperties = {
  code: 'ATA7002', rank: 0,
  params: (k) => ({ additionalProperty: k }), msg: () => 'must NOT have additional properties', exp: () => undefined,
  detail: additionalDetail,
}

// The current engine has no expected text for the exclusive bounds but words
// their detail as if it had one: "expected undefined, found 1".
export const exclusiveDetail = (received) => `expected undefined, found ${received}`
export const exclusiveMinimum = {
  code: 'ATA2005', on: isNum, ok: (v, n) => !(v <= n),
  params: (n) => ({ comparison: '>', limit: n }), msg: (n) => `must be > ${n}`, exp: () => undefined, rank: 2,
  detail: exclusiveDetail,
}
export const exclusiveMaximum = {
  code: 'ATA2006', on: isNum, ok: (v, n) => !(v >= n),
  params: (n) => ({ comparison: '<', limit: n }), msg: (n) => `must be < ${n}`, exp: () => undefined, rank: 2,
  detail: exclusiveMinimum.detail,
}
export const multipleOf = {
  code: 'ATA2007', on: isNum, ok: (v, n) => n !== 0 && (Number.isInteger(v / n) || Math.abs(v / n - Math.round(v / n)) < 1e-9),
  params: (n) => ({ multipleOf: n }), msg: (n) => `must be multiple of ${n}`, exp: () => undefined, rank: 2,
}
export const isArr = (v) => Array.isArray(v)
export const isObjV = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
export const minItems = {
  code: 'ATA2008', on: isArr, ok: (v, n) => v.length >= n,
  params: (n) => ({ limit: n }), msg: (n) => `must NOT have fewer than ${n} items`, exp: () => undefined, rank: 2,
}
export const maxItems = {
  code: 'ATA2009', on: isArr, ok: (v, n) => v.length <= n,
  params: (n) => ({ limit: n }), msg: (n) => `must NOT have more than ${n} items`, exp: () => undefined, rank: 2,
}
export const minProperties = {
  code: 'ATA2010', on: isObjV, ok: (v, n) => Object.keys(v).length >= n,
  params: (n) => ({ limit: n }), msg: (n) => `must NOT have fewer than ${n} properties`, exp: () => undefined, rank: 2,
}
export const maxProperties = {
  code: 'ATA2011', on: isObjV, ok: (v, n) => Object.keys(v).length <= n,
  params: (n) => ({ limit: n }), msg: (n) => `must NOT have more than ${n} properties`, exp: () => undefined, rank: 2,
}
export const isAny = () => true
export const constK = {
  code: 'ATA6002', on: isAny, ok: (v, n) => deq(v, n),
  params: (n) => ({ allowedValue: n }), msg: () => 'must be equal to constant', exp: (n) => repr(n), rank: 2,
}
export const enumSuggest = (v, p) => {
  if (typeof v !== 'string') return null
  const a = p.allowedValues
  if (!Array.isArray(a) || a.length === 0 || a.length > 30) return null
  const best = nearest(v, a)
  return best === null ? null : { text: `did you mean \`${best}\`?`, kind: 'typo' }
}
export const enumK = {
  code: 'ATA6001', on: isAny, ok: (v, n) => n.some((x) => deq(v, x)),
  params: (n) => ({ allowedValues: n }), msg: () => 'must be equal to one of the allowed values', exp: (n) => `one of [${n.map(repr).join(', ')}]`, rank: 2,
  suggest: enumSuggest,
}
// A keyword whose message names what it found: fail() returns the params and
// message of the failure, or null.
export const uniqueFail = (v, n) => { if (n !== true) return null; const p = dupPair(v); return p === null ? null : { params: { i: p[0], j: p[1] }, msg: `must NOT have duplicate items (items ## ${p[1]} and ${p[0]} are identical)` } }
export const uniqueItems = {
  code: 'ATA2012', on: isArr, rank: 2, exp: () => undefined,
  fail: uniqueFail,
}

export const LEAVES = { minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, pattern, format, minItems, maxItems, minProperties, maxProperties, const: constK, enum: enumK, uniqueItems }

// anyOf and oneOf: the current engine's own collapse (lib/branch-collapse.js),
// which picks the closest branch by error count and severity.
import bc from '../branch-collapse.js'
import { rankFor } from './rank.mjs'

// The errors in schema declaration order, as the current engine orders them:
// by the rank of each error's schemaPath in the root schema (rankFor of
// lib/schema-order.js, copied in ./rank.mjs; lib/aot-order.js sorts by it too), stable, and
// a collapsed error's branch errors the same way, in a copy.
const after = (a, b) => { const m = Math.min(a.length, b.length); for (let i = 0; i < m; i++) if (a[i] !== b[i]) return a[i] > b[i]; return a.length > b.length }
export function ordered (root, list) {
  const n = list.length
  if (n === 1 && !Array.isArray(list[0].branchErrors)) return list
  const out = new Array(n); const keys = new Array(n)
  for (let i = 0; i < n; i++) {
    let e = list[i]
    if (Array.isArray(e.branchErrors) && e.branchErrors.length) { const b = ordered(root, e.branchErrors); if (b !== e.branchErrors) e = Object.assign({}, e, { branchErrors: b }) }
    const k = rankFor(root, e.schemaPath) || []
    let j = i - 1
    while (j >= 0 && after(keys[j], k)) { keys[j + 1] = keys[j]; out[j + 1] = out[j]; j-- }
    keys[j + 1] = k; out[j + 1] = e
  }
  for (let i = 0; i < n; i++) if (out[i] !== list[i]) return out
  return list
}
export const collapse = /* @__PURE__ */ (() => bc._collapse)()
export const not = { code: 'ATA4005', keyword: 'not', msg: 'must NOT be valid', rank: 3 }
export const branchRank = 3

// unevaluatedProperties false: one error per property; unevaluatedItems
// false: one error naming the first unevaluated index, worded as a length.
export const unevaluatedDetail = (received, v, p) => `unevaluated property "${p.unevaluatedProperty}"`
export const unevaluatedProperties = { code: 'ATA7003', msg: 'must NOT have unevaluated properties', rank: 0, detail: unevaluatedDetail }
export const unevaluatedItems = { code: 'ATA7004', rank: 0 }

// The false schema.
export const falseSchema = { code: 'ATA4005', keyword: 'not', msg: 'boolean schema is false', rank: 3 }
// contains, minContains, maxContains: one error, keyword contains.
export const contains = { code: 'ATA7007', rank: 2 }


// Keywords that carry no constraint.
export const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly'])
