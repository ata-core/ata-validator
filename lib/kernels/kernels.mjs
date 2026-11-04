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
// The helpers here are ES modules all the way down: a CommonJS file reachable
// from ata-validator/kernels stays in some bundlers' output unused (see
// scripts/gen-kernels-cjs.js). What reads the current engine's CommonJS
// files at compile time lives in ./leaves.mjs.
import { _deq, duplicatePair } from './unique.mjs'
import { repr } from './rt.mjs'

// JSON equality and the duplicate search, the functions every engine shares.
export const deq = _deq
export const dupPair = duplicatePair

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
const typeOk = (v, n) => typeof n === 'string' ? isType(v, n) : isTypes(v, n)
const typeParams = (n) => ({ type: n })
const typeMsg = (n) => `must be ${typeof n === 'string' ? n : n.join(', ')}`
export const type = {
  kw: 'type', code: 'ATA1001', on: null, ok: typeOk, params: typeParams, msg: typeMsg, exp: (n) => String(n),
  rank: 1, detail: typeDetail, suggest: typeSuggest,
}
// The plain shape's view of a descriptor (richErrors: false): the keyword,
// its check, its params and its message, the same functions, without the
// detail and hint the rich shape adds (lib/kernels/table.mjs).
export const typeP = { kw: 'type', ok: typeOk, params: typeParams, msg: typeMsg }

const minLengthOk = (v, n) => cpLen(v) >= n
const minLengthParams = (n) => ({ limit: n })
const minLengthMsg = (n) => `must NOT have fewer than ${n} characters`
export const minLength = {
  kw: 'minLength', code: 'ATA2001', on: isStr, ok: minLengthOk,
  params: minLengthParams, msg: minLengthMsg, exp: (n) => `string with ≥${n} chars`, rank: 2,
}
export const minLengthP = { kw: 'minLength', on: isStr, ok: minLengthOk, params: minLengthParams, msg: minLengthMsg }
const maxLengthOk = (v, n) => cpLen(v) <= n
const maxLengthParams = (n) => ({ limit: n })
const maxLengthMsg = (n) => `must NOT have more than ${n} characters`
export const maxLength = {
  kw: 'maxLength', code: 'ATA2002', on: isStr, ok: maxLengthOk,
  params: maxLengthParams, msg: maxLengthMsg, exp: (n) => `string with ≤${n} chars`, rank: 2,
}
export const maxLengthP = { kw: 'maxLength', on: isStr, ok: maxLengthOk, params: maxLengthParams, msg: maxLengthMsg }
const minimumOk = (v, n) => !(v < n)
const minimumParams = (n) => ({ comparison: '>=', limit: n })
const minimumMsg = (n) => `must be >= ${n}`
export const minimum = {
  kw: 'minimum', code: 'ATA2003', on: isNum, ok: minimumOk,
  params: minimumParams, msg: minimumMsg, exp: (n) => `≥${n}`, rank: 2,
}
export const minimumP = { kw: 'minimum', on: isNum, ok: minimumOk, params: minimumParams, msg: minimumMsg }
const maximumOk = (v, n) => !(v > n)
const maximumParams = (n) => ({ comparison: '<=', limit: n })
const maximumMsg = (n) => `must be <= ${n}`
export const maximum = {
  kw: 'maximum', code: 'ATA2004', on: isNum, ok: maximumOk,
  params: maximumParams, msg: maximumMsg, exp: (n) => `≤${n}`, rank: 2,
}
export const maximumP = { kw: 'maximum', on: isNum, ok: maximumOk, params: maximumParams, msg: maximumMsg }
const patternOk = (v, n) => n.test(v)
const patternParams = (n) => ({ pattern: n })
const patternMsg = (n) => `must match pattern "${n}"`
export const pattern = {
  kw: 'pattern', code: 'ATA2013', on: isStr, ok: patternOk, prepare: (n) => new RegExp(n, 'u'),
  params: patternParams, msg: patternMsg, exp: (n) => `string matching /${n}/`, rank: 2,
}
export const patternP = { kw: 'pattern', on: isStr, ok: patternOk, prepare: (n) => new RegExp(n, 'u'), params: patternParams, msg: patternMsg }

// A format's detail; the format keyword itself is in ./leaves.mjs.
export const formatDetail = (received, v, p) => `not a valid ${p.format}: ${received}`
// What a format's error says, shared by the compile-time descriptor in
// ./leaves.mjs and the table interpreter (./table.mjs); the check itself is
// the format's function, the code and hint come with it.
const formatOk = (v, f) => f(v)
const formatParams = (n) => ({ format: n })
const formatMsg = (n) => `must match format "${n}"`
export const formatK = { kw: 'format', on: isStr, ok: formatOk, params: formatParams, msg: formatMsg, exp: (n) => `format '${n}'`, rank: 2, detail: formatDetail }
export const formatP = { kw: 'format', on: isStr, ok: formatOk, params: formatParams, msg: formatMsg }
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
const requiredParams = (k) => ({ missingProperty: k })
const requiredMsg = (k) => `must have required property '${k}'`
export const required = {
  kw: 'required', code: 'ATA7001', rank: 0,
  params: requiredParams, msg: requiredMsg, exp: (k) => `property '${k}'`,
  detail: requiredDetail, suggest: requiredSuggest,
}
export const requiredP = { kw: 'required', params: requiredParams, msg: requiredMsg }

export const additionalDetail = (received, v, p) => `unknown property "${p.additionalProperty}"`
const additionalParams = (k) => ({ additionalProperty: k })
const additionalMsg = () => 'must NOT have additional properties'
export const additionalProperties = {
  kw: 'additionalProperties', code: 'ATA7002', rank: 0,
  params: additionalParams, msg: additionalMsg, exp: () => undefined,
  detail: additionalDetail,
}
export const additionalP = { kw: 'additionalProperties', params: additionalParams, msg: additionalMsg }

// The current engine has no expected text for the exclusive bounds but words
// their detail as if it had one: "expected undefined, found 1".
export const exclusiveDetail = (received) => `expected undefined, found ${received}`
const exclusiveMinimumOk = (v, n) => !(v <= n)
const exclusiveMinimumParams = (n) => ({ comparison: '>', limit: n })
const exclusiveMinimumMsg = (n) => `must be > ${n}`
export const exclusiveMinimum = {
  kw: 'exclusiveMinimum', code: 'ATA2005', on: isNum, ok: exclusiveMinimumOk,
  params: exclusiveMinimumParams, msg: exclusiveMinimumMsg, exp: () => undefined, rank: 2,
  detail: exclusiveDetail,
}
export const exclusiveMinimumP = { kw: 'exclusiveMinimum', on: isNum, ok: exclusiveMinimumOk, params: exclusiveMinimumParams, msg: exclusiveMinimumMsg }
const exclusiveMaximumOk = (v, n) => !(v >= n)
const exclusiveMaximumParams = (n) => ({ comparison: '<', limit: n })
const exclusiveMaximumMsg = (n) => `must be < ${n}`
export const exclusiveMaximum = {
  kw: 'exclusiveMaximum', code: 'ATA2006', on: isNum, ok: exclusiveMaximumOk,
  params: exclusiveMaximumParams, msg: exclusiveMaximumMsg, exp: () => undefined, rank: 2,
  detail: exclusiveDetail,
}
export const exclusiveMaximumP = { kw: 'exclusiveMaximum', on: isNum, ok: exclusiveMaximumOk, params: exclusiveMaximumParams, msg: exclusiveMaximumMsg }
const multipleOfOk = (v, n) => n !== 0 && (Number.isInteger(v / n) || Math.abs(v / n - Math.round(v / n)) < 1e-9)
const multipleOfParams = (n) => ({ multipleOf: n })
const multipleOfMsg = (n) => `must be multiple of ${n}`
export const multipleOf = {
  kw: 'multipleOf', code: 'ATA2007', on: isNum, ok: multipleOfOk,
  params: multipleOfParams, msg: multipleOfMsg, exp: () => undefined, rank: 2,
}
export const multipleOfP = { kw: 'multipleOf', on: isNum, ok: multipleOfOk, params: multipleOfParams, msg: multipleOfMsg }
export const isArr = (v) => Array.isArray(v)
export const isObjV = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const minItemsOk = (v, n) => v.length >= n
const minItemsParams = (n) => ({ limit: n })
const minItemsMsg = (n) => `must NOT have fewer than ${n} items`
export const minItems = {
  kw: 'minItems', code: 'ATA2008', on: isArr, ok: minItemsOk,
  params: minItemsParams, msg: minItemsMsg, exp: () => undefined, rank: 2,
}
export const minItemsP = { kw: 'minItems', on: isArr, ok: minItemsOk, params: minItemsParams, msg: minItemsMsg }
const maxItemsOk = (v, n) => v.length <= n
const maxItemsParams = (n) => ({ limit: n })
const maxItemsMsg = (n) => `must NOT have more than ${n} items`
export const maxItems = {
  kw: 'maxItems', code: 'ATA2009', on: isArr, ok: maxItemsOk,
  params: maxItemsParams, msg: maxItemsMsg, exp: () => undefined, rank: 2,
}
export const maxItemsP = { kw: 'maxItems', on: isArr, ok: maxItemsOk, params: maxItemsParams, msg: maxItemsMsg }
const minPropertiesOk = (v, n) => Object.keys(v).length >= n
const minPropertiesParams = (n) => ({ limit: n })
const minPropertiesMsg = (n) => `must NOT have fewer than ${n} properties`
export const minProperties = {
  kw: 'minProperties', code: 'ATA2010', on: isObjV, ok: minPropertiesOk,
  params: minPropertiesParams, msg: minPropertiesMsg, exp: () => undefined, rank: 2,
}
export const minPropertiesP = { kw: 'minProperties', on: isObjV, ok: minPropertiesOk, params: minPropertiesParams, msg: minPropertiesMsg }
const maxPropertiesOk = (v, n) => Object.keys(v).length <= n
const maxPropertiesParams = (n) => ({ limit: n })
const maxPropertiesMsg = (n) => `must NOT have more than ${n} properties`
export const maxProperties = {
  kw: 'maxProperties', code: 'ATA2011', on: isObjV, ok: maxPropertiesOk,
  params: maxPropertiesParams, msg: maxPropertiesMsg, exp: () => undefined, rank: 2,
}
export const maxPropertiesP = { kw: 'maxProperties', on: isObjV, ok: maxPropertiesOk, params: maxPropertiesParams, msg: maxPropertiesMsg }
export const isAny = () => true
// The guard a kernel's `on` names, by identity: the IR writes the name, and a
// minifier that renames the functions (the front end in a browser bundle)
// must not change it.
export const GUARD_NAME = /* @__PURE__ */ (() => new Map([[isStr, 'isStr'], [isNum, 'isNum'], [isArr, 'isArr'], [isObjV, 'isObjV'], [isAny, 'isAny']]))()
const constOk = (v, n) => deq(v, n)
const constParams = (n) => ({ allowedValue: n })
const constMsg = () => 'must be equal to constant'
const constExp = (n) => repr(n)
export const constK = {
  kw: 'const', code: 'ATA6002', on: isAny, ok: constOk,
  params: constParams, msg: constMsg, exp: constExp, rank: 2,
}
export const constP = { kw: 'const', on: isAny, ok: constOk, params: constParams, msg: constMsg }
// const and enum whose values are all primitives: equal to one exactly when
// === to it (JSON numbers have no NaN, and 0 and -0 are one value to JSON
// equality too), so a bundle of such schemas carries no deep equality.
const constPrimOk = (v, n) => v === n
export const constPrimK = {
  kw: 'const', code: 'ATA6002', on: isAny, ok: constPrimOk,
  params: constParams, msg: constMsg, exp: constExp, rank: 2,
}
export const constPrimP = { kw: 'const', on: isAny, ok: constPrimOk, params: constParams, msg: constMsg }
export const enumSuggest = (v, p) => {
  if (typeof v !== 'string') return null
  const a = p.allowedValues
  if (!Array.isArray(a) || a.length === 0 || a.length > 30) return null
  const best = nearest(v, a)
  return best === null ? null : { text: `did you mean \`${best}\`?`, kind: 'typo' }
}
const enumOk = (v, n) => n.some((x) => deq(v, x))
const enumParams = (n) => ({ allowedValues: n })
const enumMsg = () => 'must be equal to one of the allowed values'
const enumExp = (n) => `one of [${n.map(repr).join(', ')}]`
export const enumK = {
  kw: 'enum', code: 'ATA6001', on: isAny, ok: enumOk,
  params: enumParams, msg: enumMsg, exp: enumExp, rank: 2,
  suggest: enumSuggest,
}
export const enumP = { kw: 'enum', on: isAny, ok: enumOk, params: enumParams, msg: enumMsg }
const enumPrimOk = (v, n) => n.indexOf(v) !== -1
export const enumPrimK = {
  kw: 'enum', code: 'ATA6001', on: isAny, ok: enumPrimOk,
  params: enumParams, msg: enumMsg, exp: enumExp, rank: 2,
  suggest: enumSuggest,
}
export const enumPrimP = { kw: 'enum', on: isAny, ok: enumPrimOk, params: enumParams, msg: enumMsg }
// A keyword whose message names what it found: fail() returns the params and
// message of the failure, or null.
export const uniqueFail = (v, n) => { if (n !== true) return null; const p = dupPair(v); return p === null ? null : { params: { i: p[0], j: p[1] }, msg: `must NOT have duplicate items (items ## ${p[1]} and ${p[0]} are identical)` } }
export const uniqueItems = {
  kw: 'uniqueItems', code: 'ATA2012', on: isArr, rank: 2, exp: () => undefined,
  fail: uniqueFail,
}


// anyOf and oneOf: the current engine's own collapse (lib/branch-collapse.js),
// which picks the closest branch by error count and severity.
import { __ataCollapse } from './collapse.mjs'
export const collapse = __ataCollapse
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
