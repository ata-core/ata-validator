// The IR. Statements: seq, if, let, bind (locals for the rest of a sequence),
// keys (each key: Object.keys, for-in with an own filter, or own __proto__
// last), range, count/incr, do (an expression for its effect), ret, require
// (an in-place call whose failure is this node's), fail (verdict: return
// false; errors: push), branches (anyOf/oneOf through the collapse),
// setDefault and fcall (the default fill). Expressions: var, lit, get,
// field, own, not, and, or, cmp, isObj, isObjAny, isArr, len, plainProto,
// type, guard, kernel, kfail, known, re, seg, cat, str, obj, pcall, and the
// annotation operations (annKey, annHasKey, annPrefix, annAll, annAllSet,
// annAt, annAtHas, annN, firstUneval). A procedure is a schema compiled once
// per mode (verdict, dual, ann, fill) with the parameters d, e, s, P, V, SP,
// A; both backends memoize procedures by schema object, which closes
// reference cycles.
//
// IR front end: the only place keyword semantics live. It turns a
// schema into procedures of IR (README.md) that the two backends read:
// emit.mjs writes JavaScript, run.mjs builds closures.
//
// Everything the schema fixes is decided here: messages, expected text,
// params, schema paths where they are static, which guards a known type makes
// redundant, whether a node collects annotations, which resources a
// $dynamicRef can land on.

import { type, required, additionalProperties, LEAVES, ANNOTATIONS, TYPES, falseSchema, contains, not as notK, branchRank, unevaluatedProperties as uPK, unevaluatedItems as uIK, collapse, makeHintSuggest, GUARD_NAME } from '../kernels/kernels.mjs'
import { isObj } from '../kernels/rt.mjs'
import { buildIndex } from './refs.mjs'
import draft7 from '../draft7.js'

// Under ctx, where each keyword runs in the current engine's walk of one node
// (lib/interpreter-core.js eval): references, the value's own checks, the
// custom keywords, arrays, objects, the in-place applicators, then the
// unevaluated keywords and the custom keywords declared post.
const CTX_RANK = { $ref: 0, $dynamicRef: 1, type: 2, enum: 3, const: 4, multipleOf: 5, maximum: 5, exclusiveMaximum: 5, minimum: 5, exclusiveMinimum: 5, maxLength: 6, minLength: 6, pattern: 6, format: 6, minItems: 8, maxItems: 8.1, uniqueItems: 8.2, prefixItems: 8.3, items: 8.4, additionalItems: 8.45, contains: 8.5, required: 9, minProperties: 10, maxProperties: 10, dependentRequired: 11, propertyNames: 12, properties: 13, dependentSchemas: 14, allOf: 15, anyOf: 17, oneOf: 18, not: 19, if: 20, then: 20, else: 20 }
const CTX_CUSTOM = 7
const CTX_MACRO = 16
const CTX_LAST = 21

// Every keyword name some dialect or the current engine gives a meaning to.
// One of these the front end does not handle above is refused; a name
// outside the set is ignored, as the current engine ignores it.
const MEANINGFUL = new Set(['$schema', '$id', 'id', '$ref', '$defs', 'definitions', '$anchor', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor', '$vocabulary', '$comment', 'type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'maxContains', 'minContains', 'maxProperties', 'minProperties', 'required', 'dependentRequired', 'dependencies', 'items', 'prefixItems', 'additionalItems', 'contains', 'properties', 'patternProperties', 'additionalProperties', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'format', 'contentEncoding', 'contentMediaType', 'contentSchema', 'title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly', 'examples',
  // The current engine's own: OpenAPI's nullable, custom error messages and
  // $data references. (The discriminator means something only to the compat
  // layer; the Validator ignores it, and so does the IR.)
  'nullable', 'errorMessage', '$data'])
import dialect from '../dialect.js'
import keywordsLib from '../keywords.js'
import vocabularies from '../vocabularies.js'
import { orderCustom } from '../kernels/custom.mjs'

// Older dialects are read the way the current engine reads them: normalized
// into 2020-12 by its own lib/draft7.js (tuple items to prefixItems,
// dependencies split, definitions, exclusive bounds, nullable), so errors
// carry the same normalized schema paths. The decision is
// lib/validator-core.js _normalizeCallerSchemaUncached, without its
// nothing-to-do scan.
const DIALECTS = new Set(['https://json-schema.org/draft/2020-12/schema', 'http://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft-07/schema', 'http://json-schema.org/draft-06/schema#', 'http://json-schema.org/draft-06/schema', 'http://json-schema.org/draft-04/schema#', 'http://json-schema.org/draft-04/schema', 'https://json-schema.org/draft/2019-09/schema'])
export function normalize (s, inherit = 0) {
  if (s === null || typeof s !== 'object') return s
  const code = s.$schema !== undefined ? dialect.draftCode(s.$schema) : inherit
  const needsDraft7 = code === 1 || code === 2 || code === 4
  const copy = structuredClone(s)
  if (needsDraft7) draft7.normalizeDraft7(copy, true, code === 2 || code === 4, code === 4)
  if (code === 3) draft7.normalizeDraft2019(copy, true)
  draft7.normalizeNullable(copy)
  draft7.normalizeExclusiveBounds(copy)
  return copy
}

// ---- IR constructors -------------------------------------------------------
export const lit = (v) => ({ t: 'lit', v })
export const vr = (n) => ({ t: 'var', n })
const seq = (...body) => ({ t: 'seq', body: body.flat().filter(Boolean) })
const iff = (c, then, els = null) => ({ t: 'if', c, then, else: els })
const not = (e) => ({ t: 'not', e })
const and = (...a) => a.reduce((x, y) => ({ t: 'and', a: x, b: y }))
const or = (...a) => a.reduce((x, y) => ({ t: 'or', a: x, b: y }))
const get = (o, k) => ({ t: 'get', o, k })
const own = (o, k) => ({ t: 'own', o, k })
const cmp = (op, a, b) => ({ t: 'cmp', op, a, b })
const obj = (fields) => ({ t: 'obj', fields })
const isLit = (e) => e.t === 'lit'
// A path or schema path: literals fold now, the rest joins at run time.
export const cat = (a, suffix) => catE(a, lit(suffix))
const catE = (a, b) => {
  if (isLit(a) && isLit(b)) return lit(a.v + b.v)
  // x + "a" + "b" is x + "ab"
  if (a.t === 'cat' && isLit(a.b) && isLit(b)) return { t: 'cat', a: a.a, b: lit(a.b.v + b.v) }
  return { t: 'cat', a, b }
}

const seg = (k) => k.replace(/~/g, '~0').replace(/\//g, '~1')
const INHERITED = (k) => k in Object.prototype
const IMPLIED = { string: ['isStr'], integer: ['isNum'], number: ['isNum'], array: ['isArr'], object: ['isObjV'] }

// `schemas`: the documents a reference may leave this one for, as the
// current engine's `schemas` option takes them (an object keyed by URI, or an
// array of schemas with $id); each is normalized in its own dialect, a
// document without $schema in the root's. `metaschemas`: a Map of the
// standard metaschemas, loaded when a reference names one.
export function front (schema, opts = {}) {
  // Whether the dynamic scope is needed is only known once every document a
  // reference reaches has been read: a $dynamicRef can sit in a registry
  // document or a metaschema. A build that met one without tracking the
  // scope is thrown away and done again with it (it never answers on its own).
  const first = build(schema, opts, false)
  return first.sawDynamic && !first.dynamic ? build(schema, opts, true) : first
}

function build (schema, { assertFormat = true, schemas = null, metaschemas = null, errorMessages = false, formats = null, keywords = null, baseURI = null } = {}, forceDynamic) {
  const rootCode = schema && typeof schema === 'object' && schema.$schema !== undefined ? dialect.draftCode(schema.$schema) : 0
  schema = normalize(schema)
  // The address the schema came from is its base when it declares no $id of
  // its own (lib/validator-core.js _materializeSchema).
  if (typeof baseURI === 'string' && baseURI !== '' && schema && typeof schema === 'object' && !Array.isArray(schema) && typeof schema.$id !== 'string') schema = { ...schema, $id: baseURI }
  let registry = null
  if (schemas) {
    registry = new Map()
    const add = (key, doc) => {
      const n = normalize(doc, rootCode)
      if (key) registry.set(key, n)
      const id = n && typeof n === 'object' && typeof n.$id === 'string' ? n.$id : null
      if (id && id !== key) registry.set(id, n)
    }
    if (Array.isArray(schemas)) for (const d of schemas) add(null, d)
    else for (const [k, d] of Object.entries(schemas)) add(k, d)
  }
  // A root that names a registered meta-schema with a $vocabulary loses the
  // keywords of the vocabularies it leaves out, which then mean nothing, as
  // in the current engine (lib/validator-core.js _applyVocabularies).
  if (registry !== null && schema && typeof schema === 'object' && typeof schema.$schema === 'string') {
    const meta = registry.get(schema.$schema)
    if (meta && typeof meta === 'object' && meta.$vocabulary && typeof meta.$vocabulary === 'object') {
      const enabled = vocabularies.enabledKeywords(meta)
      if (enabled) schema = vocabularies.stripDisabledKeywords(schema, enabled)
    }
  }
  const external = metaschemas ? (uri) => { const d = metaschemas.get(uri) || metaschemas.get(uri + '#'); return d === undefined ? undefined : normalize(d) } : null
  const index = buildIndex(schema, registry, external)
  // The v1 dialect, declared at the root (lib/dialect.js isV1Dialect).
  const v1 = dialect.isV1Dialect(schema)
  // Custom keywords (the `keywords` option), normalized as the current engine
  // normalizes them, so a definition it refuses is refused here with the
  // same message. One that reads its data's context is not taken yet.
  const kw = keywords ? keywordsLib.normalizeKeywords(keywords) : null
  // A keyword that reads its data's context (dataContext) may change the
  // value where it sits. The current engine then answers from its collecting
  // walk alone, in its own order, every subschema walked with paths; the IR
  // follows that walk for such a schema (ctx).
  const ctx = kw !== null && keywordsLib.schemaUsesDataContext(schema, kw)
  // What a node's custom keyword compiled to, or its macro expanded to: once
  // per node, as the interpreted engine builds them once per plan, though the
  // IR builds a node for each mode.
  const built = new WeakMap()
  const customOf = (s, k) => {
    let m = built.get(s); if (m === undefined) built.set(s, m = new Map())
    if (m.has(k)) return m.get(k)
    const def = kw[k]; const n = s[k]; let out
    if (def.macro !== null) out = { macro: def.macro(n, s) }
    else if (def.compile !== null) {
      const fn = def.compile(n, s)
      if (typeof fn !== 'function') throw new Error(`keyword "${k}": compile must return a function`)
      out = { keyword: k, fn, types: def.types, before: def.before || null, post: def.post === true, ctx: def.dataContext === true }
    } else {
      const validate = def.validate
      const fn = def.dataContext ? (data, c) => validate(n, data, s, c) : (data) => validate(n, data, s)
      // Errors the function writes land on itself, read from here.
      fn.source = validate
      out = { keyword: k, fn, types: def.types, before: def.before || null, post: def.post === true, ctx: def.dataContext === true }
    }
    m.set(k, out)
    return out
  }
  const usesDyn = (v) => v !== null && typeof v === 'object' && (Array.isArray(v) ? v.some(usesDyn) : ('$dynamicRef' in v || Object.values(v).some(usesDyn)))
  const dynamic = forceDynamic || usesDyn(schema)
  let sawDynamic = false
  const procs = new Map() // id -> { id, mode, base, body }
  const memo = new Map() // mode -> Map(schema -> id)
  let tmp = 0
  const fresh = (p) => p + (++tmp)
  let needsRelate = false

  // A procedure: one schema object compiled once per mode. `verdict` returns
  // at the first failure and builds no errors; `dual` takes the error list e
  // (null for a verdict); `ann` is dual plus the annotation collector A.
  // Named before its body so a reference cycle calls itself.
  // `entry`: the root as the entry point, whose path is "" and schema path
  // "#", so they fold into literals; a $ref back to the root uses the
  // general procedure.
  function proc (s, mode, entry = false) {
    const key = entry ? mode + ':entry' : mode
    let m = memo.get(key)
    if (!m) memo.set(key, m = new Map())
    if (m.has(s)) return m.get(s)
    const id = fresh(mode[0])
    m.set(s, id)
    const p = { id, mode, base: index.baseOf(s), body: null }
    procs.set(id, p)
    const saved = cur
    cur = { mode, lexBase: index.baseOf(s), ann: mode === 'ann' }
    p.body = entry ? node(s, vr('d'), lit(''), lit('#'), vr('d')) : node(s, vr('d'), vr('P'), vr('SP'), vr('V'))
    cur = saved
    return id
  }
  let cur = null

  // A failure: the backends turn it into `return false` in a verdict and a
  // pushed error otherwise.
  const fail = (err) => ({ t: 'fail', err })
  // detail and suggest are kernel functions; `src` is how generated code
  // names them (an import, or a construction such as a format's hint).
  const ref = (fn, src) => fn ? { fn, src: src || fn.name } : null
  const err = (code, kw, path, sp, params, msg, exp, rank, ev, detail, suggest) =>
    ({ code, kw, path, sp, params, msg, exp, rank, ev, detail: detail && detail.fn ? detail : ref(detail), suggest: suggest && suggest.fn ? suggest : ref(suggest) })
  const paramsOf = (o) => obj(Object.entries(o).map(([k, v]) => [k, lit(v)]))

  // Run a subschema in place (same value): call its procedure. Under
  // annotations the call gets a collector of its own, merged when valid.
  // `ann`: whether the calling node collects annotations (nodeBody's own
  // flag; cur.ann is already cleared for the node's children by then).
  const inPlace = (s, x, path, sp, ev, ann = cur.ann) => {
    if (cur.mode === 'verdict' && !ann) return { t: 'require', e: { t: 'pcall', proc: proc(s, 'verdict'), x, e: 'null' } }
    return { t: 'require', e: { t: 'pcall', proc: proc(s, ann ? 'ann' : 'dual'), x, path, sp, ev, e: 'inherit', ann: ann ? 'merge' : null } }
  }
  // A subschema's verdict. Under ctx the full walk with its paths, its errors
  // set aside, as the current engine walks it (every keyword runs).
  const verdictOf = (s, x, path, sp, ev) => ctx ? { t: 'pcall', proc: proc(s, 'dual'), x, path, sp, ev: ev || x, e: 'fresh' } : { t: 'pcall', proc: proc(s, 'verdict'), x, e: 'null' }

  function node (s, x, path, sp, ev) {
    if (s === true) return seq()
    if (s === false) return fail(err(falseSchema.code, falseSchema.keyword, path, sp, obj([]), lit(falseSchema.msg), undefined, falseSchema.rank, ev))
    if (!isObj(s)) throw new Error('ir: a schema must be an object or a boolean')
    // A subschema of another resource puts that resource on the dynamic
    // scope: it runs as a procedure, which does the push.
    if (dynamic && !cur.ann && index.baseOf(s) !== cur.lexBase) return inPlace(s, x, path, sp, ev)
    // A node that reads annotations runs as an `ann` procedure with a fresh
    // collector; inside one, the collector is A.
    if (!cur.ann && ('unevaluatedProperties' in s || 'unevaluatedItems' in s)) {
      if (cur.mode === 'verdict') return { t: 'require', e: { t: 'pcall', proc: proc(s, 'ann'), x, path, sp, ev, e: 'null', ann: 'none' } }
      return { t: 'require', e: { t: 'pcall', proc: proc(s, 'ann'), x, path, sp, ev, e: 'inherit', ann: 'none' } }
    }
    const ann = cur.ann
    // Children at other instance locations start without a collector.
    const saved = cur.ann
    cur.ann = false
    try { return nodeBody(s, x, path, sp, ev, ann) } finally { cur.ann = saved }
  }

  // Children at another instance location: no collector, same procedure mode.
  const child = (s, x, path, sp) => {
    const saved = cur.ann
    cur.ann = false
    try { return node(s, x, path, sp, x) } finally { cur.ann = saved }
  }

  function nodeBody (s, x, path, sp, ev, ann) {
    const verdict = cur.mode === 'verdict'
    // In a verdict the first failure returns, so a single type checked first
    // makes the type known to every later keyword: the guards it implies go.
    const known = verdict && typeof s.type === 'string' && TYPES[s.type] ? s.type : null
    const implied = (g) => known !== null && (IMPLIED[known] || []).includes(g)
    const objKw = ['properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'dependentRequired', 'dependentSchemas', 'unevaluatedProperties'].some((k) => k in s)
    const knownObj = known === 'object' && objKw
    const o = vr(fresh('o')); const plain = vr(fresh('p'))
    // Is x an object, and is its prototype Object.prototype (then a defined
    // value under a name Object.prototype lacks is an own property).
    const has = (name, kExpr) => name !== null && INHERITED(name) ? own(x, kExpr) : or(plain, own(x, kExpr))
    const props = isObj(s.properties) ? s.properties : {}
    const req = knownObj && Array.isArray(s.required) ? s.required : []
    const typedReq = new Set(req.filter((r) => !INHERITED(r) && isObj(props[r]) && 'type' in props[r]))
    let out = []
    const lets = []
    if (objKw && !knownObj) lets.push([o.n, { t: 'isObj', x }], [plain.n, and(o, { t: 'plainProto', x })])
    const keys = known !== null ? ['type', ...Object.keys(s).filter((k) => k !== 'type')] : Object.keys(s)
    const customOps = []
    // Under ctx each keyword's statements go to its place in the current
    // engine's walk (lib/interpreter-core.js eval), not schema order.
    const buckets = ctx ? new Map() : null
    const bucket = (r) => { let b = buckets.get(r); if (b === undefined) buckets.set(r, b = []); return b }
    for (const k of keys) {
      const n = s[k]
      if (ctx) {
        out = bucket(kw[k] !== undefined && kw[k].macro !== null ? CTX_MACRO : CTX_RANK[k] !== undefined ? CTX_RANK[k] : CTX_LAST)
        // Folded into the one walk over the object's own keys, below.
        if (k === 'properties' || k === 'patternProperties' || k === 'additionalProperties') continue
        // Missing, read the current engine's way: an own key, and for a name
        // properties does not declare, a defined value.
        if (k === 'required' && Array.isArray(n)) {
          needsRelate = needsRelate || s.additionalProperties !== undefined
          out.push(iff(o, seq(n.map((r) => iff(r in props ? not(own(x, lit(r))) : or(not(own(x, lit(r))), cmp('===', get(x, lit(r)), lit(undefined))), fail(err(required.code, 'required', path, cat(sp, '/required'), paramsOf(required.params(r)), lit(required.msg(r)), required.exp(r), required.rank, ev, required.detail, required.suggest)))))))
          continue
        }
        if (k === 'dependentRequired' && isObj(n)) {
          const inner = []
          for (const a in n) inner.push(iff(own(x, lit(a)), seq(n[a].map((r) => iff(not(own(x, lit(r))), fail(err('ATA7005', 'required', path, cat(sp, '/dependentRequired'), paramsOf(required.params(r)), lit(required.msg(r)), required.exp(r), required.rank, ev, required.detail, required.suggest)))))))
          out.push(iff(o, seq(inner)))
          continue
        }
      }
      if (kw !== null && kw[k] !== undefined) {
        const c = customOf(s, k)
        if (c.macro === undefined) { if (c.fn) customOps.push(c); continue }
        // A macro: the schema it returns runs in place, under the keyword's
        // path, and the keyword reports an error of its own when it fails.
        const m = c.macro
        if (m !== null && typeof m === 'object' && JSON.stringify(m).includes('"$ref"')) throw new Error(`ir: macro keyword "${k}" returns a $ref`)
        const msp = cat(sp, '/' + k)
        const own = fail(err('ATA9001', k, path, msp, paramsOf({ keyword: k }), lit(`must pass "${k}" keyword validation`), undefined, 2, ev))
        out.push(iff(not(verdict ? verdictOf(m, x, path, msp, ev) : { t: 'pcall', proc: proc(m, ann ? 'ann' : 'dual'), x, path, sp: msp, ev, e: 'inherit', ann: ann ? 'merge' : null }), own))
        continue
      }
      if (k === 'type') {
        out.push(iff(not({ t: 'type', x, types: typeof n === 'string' ? [n] : n }), fail(err(type.code, 'type', path, cat(sp, '/type'), obj([['type', lit(n)]]), lit(type.msg(n)), type.exp(n), type.rank, ev, type.detail, type.suggest))))
        if (knownObj) {
          out.push({ t: 'bind', names: [[o.n, lit(true)], [plain.n, { t: 'plainProto', x }]] })
          if (req.length) {
            out.push(iff(and(not(plain), not(and(...req.map((r) => own(x, lit(r)))))), { t: 'ret' }))
            for (const r of req) if (!typedReq.has(r)) out.push(iff(INHERITED(r) ? or(cmp('===', get(x, lit(r)), lit(undefined)), not(own(x, lit(r)))) : cmp('===', get(x, lit(r)), lit(undefined)), { t: 'ret' }))
          }
        }
      } else if (k === 'properties') {
        const inner = []
        // The entries that check their own presence, by name, for a backend
        // that would rather visit the object's keys than look up every name
        // (a verdict on an object that names hundreds of properties). Not
        // with annotations or custom keywords, whose order is observable.
        const keyed = []
        for (const p in n) {
          const y = vr(fresh('x'))
          const body = child(n[p], y, isLit(path) && path.v === '' ? lit('/' + seg(p)) : cat(path, '/' + seg(p)), cat(sp, '/properties/' + seg(p)))
          // An own key is evaluated even when its value is undefined.
          if (ann) inner.push(iff(own(x, lit(p)), { t: 'do', e: { t: 'annKey', k: lit(p) } }))
          if (typedReq.has(p)) inner.push({ t: 'let', name: y.n, value: get(x, lit(p)), body })
          else { keyed.push([p, inner.length]); inner.push({ t: 'let', name: y.n, value: get(x, lit(p)), body: iff(and(cmp('!==', y, lit(undefined)), has(p, lit(p))), body) }) }
        }
        if (inner.length) out.push(iff(o, { t: 'props', x, body: inner, keyed: ann || kw !== null ? null : keyed }))
      } else if (k === 'patternProperties') {
        const kv = vr(fresh('k'))
        const inner = []
        for (const p in n) {
          const y = vr(fresh('x'))
          const body = child(n[p], y, catE(path, catE(lit('/'), { t: 'seg', k: kv })), cat(sp, '/patternProperties/' + seg(p)))
          inner.push(iff({ t: 're', src: p, k: kv }, seq(ann ? { t: 'do', e: { t: 'annKey', k: kv } } : null, { t: 'let', name: y.n, value: get(x, kv), body })))
        }
        out.push(iff(o, { t: 'keys', obj: x, k: kv.n, order: 'keys', body: seq(inner) }))
      } else if (k === 'required') {
        needsRelate = needsRelate || s.additionalProperties !== undefined
        if (knownObj) continue
        out.push(iff(o, seq(n.map((r) => iff(or(cmp('===', get(x, lit(r)), lit(undefined)), not(has(r, lit(r)))), fail(err(required.code, 'required', path, cat(sp, '/required'), paramsOf(required.params(r)), lit(required.msg(r)), required.exp(r), required.rank, ev, required.detail, required.suggest)))))))
      } else if (k === 'dependentRequired') {
        const inner = []
        for (const a in n) inner.push(iff(own(x, lit(a)), seq(n[a].map((r) => iff(or(cmp('===', get(x, lit(r)), lit(undefined)), not(has(r, lit(r)))), fail(err('ATA7005', 'required', path, cat(sp, '/dependentRequired'), paramsOf(required.params(r)), lit(required.msg(r)), required.exp(r), required.rank, ev, required.detail, required.suggest)))))))
        out.push(iff(o, seq(inner)))
      } else if (k === 'additionalProperties') {
        const known2 = Object.keys(s.properties || {})
        const pats = Object.keys(s.patternProperties || {})
        const kv = vr(fresh('k'))
        // Is the key named by properties or matched by patternProperties.
        const isKnown = { t: 'known', k: kv, names: known2, pats }
        if (n === false) {
          // for-in visits own enumerable keys in Object.keys order; the own
          // check drops inherited ones.
          out.push(iff(o, { t: 'keys', obj: x, k: kv.n, order: 'forin', body: iff(and(not(isKnown), has(null, kv)), seq(ann ? { t: 'do', e: { t: 'annKey', k: kv } } : null, fail(err(additionalProperties.code, 'additionalProperties', path, cat(sp, '/additionalProperties'), obj([['additionalProperty', kv]]), lit(additionalProperties.msg()), undefined, additionalProperties.rank, ev, additionalProperties.detail)))) }))
        } else {
          const y = vr(fresh('x'))
          const body = child(n, y, catE(path, catE(lit('/'), { t: 'seg', k: kv })), cat(sp, '/additionalProperties'))
          out.push(iff(o, { t: 'keys', obj: x, k: kv.n, order: 'protoLast', body: iff(not(isKnown), seq(ann ? { t: 'do', e: { t: 'annKey', k: kv } } : null, { t: 'let', name: y.n, value: get(x, kv), body })) }))
        }
      } else if (k === 'propertyNames') {
        // The name is checked; the errors report the object.
        const kv = vr(fresh('k'))
        const saved = cur.ann; cur.ann = false
        const body = node(n, kv, path, cat(sp, '/propertyNames'), x)
        cur.ann = saved
        out.push(iff(o, { t: 'keys', obj: x, k: kv.n, order: 'keys', body }))
      } else if (k === 'prefixItems') {
        const inner = []
        if (ann) inner.push({ t: 'do', e: { t: 'annPrefix', n: n.length, arr: x } })
        n.forEach((ps, i) => {
          const y = vr(fresh('x'))
          inner.push(iff(cmp('>', { t: 'len', x }, lit(i)), { t: 'let', name: y.n, value: get(x, lit(i)), body: child(ps, y, isLit(path) && path.v === '' ? lit('/' + i) : cat(path, '/' + i), cat(sp, '/prefixItems/' + i)) }))
        })
        out.push(iff({ t: 'isArr', x }, seq(inner)))
      } else if (k === 'items') {
        const start = Array.isArray(s.prefixItems) ? s.prefixItems.length : 0
        const j = vr(fresh('j')); const y = vr(fresh('x'))
        const body = child(n, y, catE(path, catE(lit('/'), j)), cat(sp, '/items'))
        out.push(iff({ t: 'isArr', x }, seq(ann ? iff(cmp('>', { t: 'len', x }, lit(start)), { t: 'do', e: { t: 'annAll' } }) : null, { t: 'range', arr: x, from: start, i: j.n, body: { t: 'let', name: y.n, value: get(x, j), body } })))
      } else if (k === 'contains') {
        const min = s.minContains === undefined ? 1 : s.minContains
        const max = s.maxContains
        const c = vr(fresh('c')); const i = vr(fresh('i'))
        const checks = [iff(cmp('<', c, lit(min)), fail(err(contains.code, 'contains', path, cat(sp, '/contains'), obj([['minContains', lit(min)]]), lit(`must contain at least ${min} valid item(s)`), undefined, contains.rank, ev)))]
        if (max !== undefined) checks.push(iff(cmp('>', c, lit(max)), fail(err(contains.code, 'contains', path, cat(sp, '/contains'), obj([['minContains', lit(min)], ['maxContains', lit(max)]]), lit(`must NOT contain more than ${max} valid item(s)`), undefined, contains.rank, ev))))
        out.push(iff({ t: 'isArr', x }, { t: 'count', name: c.n, body: seq({ t: 'range', arr: x, from: 0, i: i.n, body: iff(ctx ? verdictOf(n, get(x, i), catE(path, catE(lit('/'), i)), cat(sp, '/contains')) : { t: 'pcall', proc: proc(n, 'verdict'), x: get(x, i), e: 'null' }, seq({ t: 'incr', name: c.n }, ann ? { t: 'do', e: { t: 'annAt', i } } : null)) }, checks) }))
      } else if (k === 'allOf') {
        n.forEach((sub, i) => { out.push(ann ? inPlace(sub, x, path, cat(sp, '/allOf/' + i), ev, true) : node(sub, x, path, cat(sp, '/allOf/' + i), ev)) })
      } else if (k === 'anyOf' || k === 'oneOf') {
        const mode = verdict ? 'verdict' : ann ? 'ann' : 'dual'
        out.push({ t: 'branches', kw: k, procs: n.map((sub) => proc(sub, mode)), sps: n.map((_, i) => cat(sp, '/' + k + '/' + i)), titles: n.map((sub) => isObj(sub) ? sub.title : undefined), x, path, sp: cat(sp, '/' + k), ev, ann: ann ? (k === 'oneOf' ? 'onlyIfOne' : 'each') : null, rank: branchRank, collapse })
      } else if (k === 'not') {
        out.push(iff(verdictOf(n, x, path, cat(sp, '/not'), ev), fail(err(notK.code, notK.keyword, path, cat(sp, '/not'), obj([]), lit(notK.msg), undefined, notK.rank, ev))))
      } else if (k === 'if') {
        const thenB = 'then' in s ? (ann ? inPlace(s.then, x, path, cat(sp, '/then'), ev, true) : node(s.then, x, path, cat(sp, '/then'), ev)) : seq()
        const elseB = 'else' in s ? (ann ? inPlace(s.else, x, path, cat(sp, '/else'), ev, true) : node(s.else, x, path, cat(sp, '/else'), ev)) : seq()
        const cond = ann ? { t: 'pcall', proc: proc(n, 'ann'), x, path, sp: cat(sp, '/if'), ev, e: ctx ? 'fresh' : 'null', ann: 'merge' } : verdictOf(n, x, path, cat(sp, '/if'), ev)
        out.push(iff(cond, thenB, elseB))
      } else if (k === 'then' || k === 'else') {
        // Read by if; without an if they do nothing.
      } else if (k === 'dependentSchemas') {
        for (const a in n) out.push(iff(and(o, own(x, lit(a))), ann ? inPlace(n[a], x, path, cat(sp, '/dependentSchemas/' + seg(a)), ev, true) : node(n[a], x, path, cat(sp, '/dependentSchemas/' + seg(a)), ev)))
      } else if (k === '$ref') {
        // The target runs as if it stood here: same value, same paths. One
        // that names nothing fails every value that reaches it, with the
        // current engine's error, rather than refusing the schema.
        let target
        try { target = index.resolve(n, index.baseOf(s)) } catch (e) {
          if (e.unresolved !== true) throw e
          out.push(fail(err('ATA5001', '$ref', path, cat(sp, '/$ref'), paramsOf({ ref: n }), lit(`cannot resolve $ref ${n}`), undefined, 2, ev)))
          continue
        }
        out.push(inPlace(target, x, path, sp, ev, ann))
      } else if (k === '$dynamicRef') {
        sawDynamic = true
        // Resolved like $ref first; when that target declares the anchor the
        // fragment names, the outermost resource on the scope that declares
        // it wins. The candidates are known now, the choice at run time.
        const hash = n.indexOf('#')
        const name = hash !== -1 && !n.slice(hash + 1).startsWith('/') ? n.slice(hash + 1) : null
        // Under v1 the scope is searched even when the reference resolves to
        // nothing on its own; with no anchor of that name on the scope it
        // fails where it runs (lib/interpreter-core.js).
        let target
        try { target = index.resolve(n, index.baseOf(s)) } catch (e) { if (!(v1 && e.unresolved && name)) throw e }
        if (target === undefined) {
          const missing = err('ATA9001', '$dynamicRef', path, cat(sp, '/$dynamicRef'), paramsOf({ ref: n }), lit(`cannot resolve $dynamicRef ${n}`), undefined, 2, ev)
          const candidates = index.dynCandidates(name)
          if (candidates.length === 0) { out.push(fail(missing)); continue }
          const mode = verdict && !ann ? 'verdict' : ann ? 'ann' : 'dual'
          const call = mode === 'verdict' ? { t: 'pcall', proc: null, x, e: 'null' } : { t: 'pcall', proc: null, x, path, sp, ev, e: 'inherit', ann: ann ? 'merge' : null }
          call.dynamic = candidates.map(([b, t]) => [b, proc(t, mode)])
          call.missing = missing
          out.push({ t: 'require', e: call })
          continue
        }
        // Under 2020-12 the target must carry the anchor itself (bookending)
        // before the scope is consulted; v1 drops that.
        const dyn = name !== null && name !== '' && (v1 || (isObj(target) && target.$dynamicAnchor === name))
        const r = inPlace(target, x, path, sp, ev, ann)
        if (dyn) {
          const mode = r.e.proc[0] === 'v' ? 'verdict' : r.e.proc[0] === 'a' ? 'ann' : 'dual'
          r.e.dynamic = index.dynCandidates(name).map(([b, t]) => [b, proc(t, mode)])
        }
        out.push(r)
      } else if (k === 'unevaluatedProperties' || k === 'unevaluatedItems') {
        // Run after every other keyword of the node, below.
      } else if (k === '$id' || k === '$anchor' || k === '$dynamicAnchor' || k === '$vocabulary' || k === '$defs' || k === 'definitions' || k === 'minContains' || k === 'maxContains' || k === 'additionalItems' || k === 'contentMediaType' || k === 'contentEncoding' || k === 'contentSchema') {
        // additionalItems that normalization left in place has no effect (items is not a tuple);
        // the content keywords are annotations, as in the current engine.
        // Read by the index or by another keyword.
      } else if (k === 'errorMessage' && errorMessages) {
        // Applied to the finished errors by the backend that asked for it
        // (lib/error-messages.js, as the current engine applies it).
      } else if (k === '$schema') {
        // Any other URI is read as the default dialect, as the current engine
        // reads it (lib/dialect.js); v1 is told apart at the root.
      } else if (k === 'format' && !assertFormat) {
        // An annotation unless format assertion is asked for.
      } else if (LEAVES[k]) {
        const K = LEAVES[k]
        // A format the caller registered as a function (the `formats` option)
        // replaces the built-in check of that name, keeps its error code and
        // loses its hint, as in the current engine; any other value there is
        // ignored.
        const user = k === 'format' && formats !== null && typeof n === 'string' && Object.prototype.hasOwnProperty.call(formats, n) && typeof formats[n] === 'function' ? formats[n] : null
        const pv = user !== null ? user : K.prepare ? K.prepare(n) : n
        // A format the current engine does not know is not checked.
        if (k === 'format' && pv === null) continue
        const gname = GUARD_NAME.get(K.on)
        if (gname === undefined) throw new Error(`ir: keyword "${k}" has no guard`)
        const guard = implied(gname) ? null : { t: 'guard', g: gname, x }
        const code = typeof K.code === 'function' ? K.code(n) : K.code
        let suggest = K.suggest || null
        if (K.suggestFor) { const sf = user === null ? K.suggestFor(n) : null; suggest = sf ? ref(sf, `makeHintSuggest(${n}Hint)`) : null }
        if (K.fail) {
          const f = vr(fresh('f'))
          out.push(iff(guard || lit(true), { t: 'let', name: f.n, value: { t: 'kfail', K, x, n, pv }, body: iff(cmp('!==', f, lit(null)), fail(err(code, k, path, cat(sp, '/' + k), { t: 'field', o: f, k: 'params' }, { t: 'field', o: f, k: 'msg' }, K.exp(n), K.rank, ev, K.detail, suggest))) }))
          continue
        }
        const check = not({ t: 'kernel', K, kw: k, x, n, pv })
        out.push(iff(guard ? and(guard, check) : check, fail(err(code, k, path, cat(sp, '/' + k), paramsOf(K.params(n)), lit(K.msg(n)), K.exp(n), K.rank, ev, K.detail, suggest))))
      } else if (MEANINGFUL.has(k) && !ANNOTATIONS.has(k)) {
        throw new Error(`ir: keyword "${k}" is not supported`)
      }
      // Any other name means nothing to the current engine, which ignores it
      // (tsType, markdownDescription, x-...), and so does the IR.
    }
    // The node's custom keywords, in the order they declare (orderCustom):
    // each runs on the value when its `type` admits it.
    const ordered = customOps.length ? orderCustom(customOps) : []
    let post = null
    if (!ctx) { if (ordered.length) out.push({ t: 'custom', ops: ordered, x, path, sp, ev }) } else {
      const now = ordered.filter((op) => !op.post)
      if (now.length) bucket(CTX_CUSTOM).push({ t: 'custom', ops: now, x, path, sp, ev })
      const later = ordered.filter((op) => op.post)
      // Run after everything else at the node, on the value read again from
      // where it sits.
      if (later.length) post = { t: 'custom', ops: later, x, path, sp, ev, here: true }
      if ('properties' in s || 'patternProperties' in s || 'additionalProperties' in s) bucket(CTX_RANK.properties).push(ctxObjectWalk(s, x, path, sp, ev, ann, o, props))
      out = []
      for (const r of [...buckets.keys()].sort((a, b) => a - b)) out.push(...buckets.get(r))
    }
    if ('unevaluatedProperties' in s) {
      const n = s.unevaluatedProperties
      const kv = vr(fresh('k'))
      if (n === false) {
        out.push(iff(o, { t: 'keys', obj: x, k: kv.n, order: 'keys', body: iff(not({ t: 'annHasKey', k: kv }), fail(err(uPK.code, 'unevaluatedProperties', path, cat(sp, '/unevaluatedProperties'), obj([['unevaluatedProperty', kv]]), lit(uPK.msg), undefined, uPK.rank, ev, uPK.detail))) }))
      } else {
        const y = vr(fresh('x'))
        const body = child(n, y, catE(path, catE(lit('/'), { t: 'seg', k: kv })), cat(sp, '/unevaluatedProperties'))
        out.push(iff(o, { t: 'keys', obj: x, k: kv.n, order: 'protoLast', body: iff(not({ t: 'annHasKey', k: kv }), seq({ t: 'let', name: y.n, value: get(x, kv), body }, { t: 'do', e: { t: 'annKey', k: kv } })) }))
      }
    }
    if ('unevaluatedItems' in s) {
      const n = s.unevaluatedItems
      const j = vr(fresh('j'))
      if (n === false) {
        out.push(iff(and({ t: 'isArr', x }, not({ t: 'annAllSet' })), seq({ t: 'let', name: j.n, value: { t: 'firstUneval', x }, body: iff(cmp('<', j, { t: 'len', x }), fail(err(uIK.code, 'unevaluatedItems', path, cat(sp, '/unevaluatedItems'), obj([['limit', j]]), { t: 'str', parts: [lit('must NOT have more than '), j, lit(' items')] }, undefined, uIK.rank, ev))) }, { t: 'do', e: { t: 'annAll' } })))
      } else {
        const y = vr(fresh('x'))
        const body = child(n, y, catE(path, catE(lit('/'), j)), cat(sp, '/unevaluatedItems'))
        out.push(iff(and({ t: 'isArr', x }, not({ t: 'annAllSet' })), seq({ t: 'range', arr: x, from: { t: 'annN' }, i: j.n, body: iff(not({ t: 'annAtHas', i: j }), { t: 'let', name: y.n, value: get(x, j), body }) }, { t: 'do', e: { t: 'annAll' } })))
      }
    }
    if (post !== null) out.push(post)
    let body = seq(out)
    for (let i = lets.length - 1; i >= 0; i--) body = { t: 'let', name: lets[i][0], value: lets[i][1], body }
    return body
  }

  // The object's own keys, read once, each sent where the current engine
  // sends it, in the document's order: to its declared property (a value of
  // undefined is skipped, and is missing when required), to every pattern it
  // matches, and to additionalProperties when neither took it.
  function ctxObjectWalk (s, x, path, sp, ev, ann, o, props) {
    const kv = vr(fresh('k'))
    const reqIn = new Set(Array.isArray(s.required) ? s.required.filter((r) => r in props) : [])
    const body = []
    for (const p in props) {
      const y = vr(fresh('x'))
      const missing = reqIn.has(p) ? fail(err(required.code, 'required', path, cat(sp, '/required'), paramsOf(required.params(p)), lit(required.msg(p)), required.exp(p), required.rank, ev, required.detail, required.suggest)) : seq()
      body.push(iff(cmp('===', kv, lit(p)), seq(ann ? { t: 'do', e: { t: 'annKey', k: kv } } : null, { t: 'let', name: y.n, value: get(x, kv), body: iff(cmp('!==', y, lit(undefined)), child(props[p], y, isLit(path) && path.v === '' ? lit('/' + seg(p)) : cat(path, '/' + seg(p)), cat(sp, '/properties/' + seg(p))), missing) })))
    }
    const pats = isObj(s.patternProperties) ? s.patternProperties : {}
    for (const src in pats) {
      const y = vr(fresh('x'))
      body.push(iff({ t: 're', src, k: kv }, seq(ann ? { t: 'do', e: { t: 'annKey', k: kv } } : null, { t: 'let', name: y.n, value: get(x, kv), body: child(pats[src], y, catE(path, catE(lit('/'), { t: 'seg', k: kv })), cat(sp, '/patternProperties/' + seg(src))) })))
    }
    const ap = s.additionalProperties
    if (ap !== undefined) {
      const isKnown = { t: 'known', k: kv, names: Object.keys(props), pats: Object.keys(pats) }
      if (ap === false) body.push(iff(not(isKnown), seq(ann ? { t: 'do', e: { t: 'annKey', k: kv } } : null, fail(err(additionalProperties.code, 'additionalProperties', path, cat(sp, '/additionalProperties'), obj([['additionalProperty', kv]]), lit(additionalProperties.msg()), undefined, additionalProperties.rank, ev, additionalProperties.detail)))))
      else {
        const y = vr(fresh('x'))
        body.push(iff(not(isKnown), seq(ann ? { t: 'do', e: { t: 'annKey', k: kv } } : null, { t: 'let', name: y.n, value: get(x, kv), body: child(ap, y, catE(path, catE(lit('/'), { t: 'seg', k: kv })), cat(sp, '/additionalProperties')) })))
      }
    }
    return iff(o, { t: 'keys', obj: x, k: kv.n, order: 'keys', body: seq(body) })
  }

  // ---- Defaults ------------------------------------------------------------
  // A specialized fill, in the order and by the rules of lib/defaults.js:
  // a node's own property defaults (absent own keys get a fresh copy), then
  // the property schemas for own keys present, then array elements (prefixItems
  // by position, items for the rest), then dependentSchemas for keys present,
  // then $ref targets and allOf members on the same value. Declined (null)
  // when the fill graph has a cycle or patternProperties/additionalProperties
  // lead to a default: there lib/defaults.js, with its guards for values that
  // contain themselves, is used as it is.
  const fills = new Map()
  let fillDeclined = false
  const fillStack = new Set()
  const reaches = new Map()
  const reachesDefault = (n) => {
    if (!isObj(n)) return false
    if (reaches.has(n)) return reaches.get(n)
    reaches.set(n, false)
    const props = isObj(n.properties) ? Object.values(n.properties) : []
    let yes = props.some((p) => isObj(p) && p.default !== undefined)
    const below = [...props, typeof n.$ref === 'string' ? safeResolve(n.$ref, n) : null, ...(Array.isArray(n.allOf) ? n.allOf : []), ...(Array.isArray(n.prefixItems) ? n.prefixItems : []), n.items, n.additionalProperties, ...(isObj(n.patternProperties) ? Object.values(n.patternProperties) : []), ...(isObj(n.dependentSchemas) ? Object.values(n.dependentSchemas) : [])]
    for (const b of below) if (!yes && reachesDefault(b)) yes = true
    reaches.set(n, yes)
    return yes
  }
  const safeResolve = (ref, n) => { try { return index.resolve(ref, index.baseOf(n)) } catch { return null } }
  const fillProc = (n) => {
    if (!isObj(n) || !reachesDefault(n)) return null
    if (fills.has(n)) return fills.get(n)
    if (fillStack.has(n)) { fillDeclined = true; return null }
    if (isObj(n.patternProperties) && Object.values(n.patternProperties).some(reachesDefault)) fillDeclined = true
    if (reachesDefault(n.additionalProperties)) fillDeclined = true
    fillStack.add(n)
    const id = fresh('f')
    const d = vr('d')
    const out = []
    const props = isObj(n.properties) ? n.properties : {}
    for (const k of Object.keys(props)) if (isObj(props[k]) && props[k].default !== undefined) out.push({ t: 'setDefault', o: d, k, v: props[k].default })
    for (const k of Object.keys(props)) { const c = fillProc(props[k]); if (c) out.push(iff(own(d, lit(k)), { t: 'fcall', proc: c, x: get(d, lit(k)) })) }
    const tuple = Array.isArray(n.prefixItems) ? n.prefixItems.map(fillProc) : []
    const each = fillProc(n.items)
    if (tuple.some(Boolean) || each) {
      const i = vr(fresh('i'))
      const per = tuple.map((t, ix) => t ? iff(cmp('===', i, lit(ix)), { t: 'fcall', proc: t, x: get(d, i) }) : null).filter(Boolean)
      out.push(iff({ t: 'isArr', x: d }, { t: 'range', arr: d, from: 0, i: i.n, body: seq(...per, each ? iff(not(cmp('<', i, lit(tuple.length))), { t: 'fcall', proc: each, x: get(d, i) }) : null) }))
    }
    if (isObj(n.dependentSchemas)) for (const k of Object.keys(n.dependentSchemas)) { const c = fillProc(n.dependentSchemas[k]); if (c) out.push(iff(and(not({ t: 'isArr', x: d }), own(d, lit(k))), { t: 'fcall', proc: c, x: d })) }
    if (typeof n.$ref === 'string') { const c = fillProc(safeResolve(n.$ref, n)); if (c) out.push({ t: 'fcall', proc: c, x: d }) }
    if (Array.isArray(n.allOf)) for (const sub of n.allOf) { const c = fillProc(sub); if (c) out.push({ t: 'fcall', proc: c, x: d }) }
    fillStack.delete(n)
    // A value that is not an object has nothing to fill.
    procs.set(id, { id, mode: 'fill', base: index.baseOf(n), body: iff({ t: 'isObjAny', x: d }, seq(out)) })
    fills.set(n, id)
    return id
  }
  const fillRoot = fillProc(schema)

  // The root as dual and as verdict procedures.
  cur = { mode: 'dual', lexBase: index.baseOf(schema), ann: false }
  const dual = proc(schema, 'dual', true)
  const verdictRoot = proc(schema, 'verdict', true)
  // `schema`: the normalized schema, which the generic default pass must read
  // too (it fills what validation applies: a draft-07 $ref drops its siblings).
  return { procs, dual, verdict: verdictRoot, dynamic, sawDynamic, relate: needsRelate, fill: fillDeclined ? 'generic' : fillRoot, schema, custom: kw !== null && keywordsLib.schemaUsesKeywords(schema, kw), ctx }
}

// What the error order reads of a schema: every key in its place, every
// subschema, and the values that identify a resource or point at one; any
// other value (a description, an enum list) becomes 0. Ranks over it are the
// ranks over the schema.
const KEEP = new Set(['$ref', '$id', 'id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$recursiveRef', '$recursiveAnchor', '$schema'])
const SUBS = new Set(['additionalProperties', 'additionalItems', 'items', 'contains', 'propertyNames', 'if', 'then', 'else', 'not', 'unevaluatedItems', 'unevaluatedProperties', 'allOf', 'anyOf', 'oneOf', 'prefixItems', 'properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'])
export function orderSkeleton (node, inMap = false) {
  if (node === null || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.map((x) => orderSkeleton(x))
  const out = {}
  for (const k of Object.keys(node)) {
    const v = node[k]
    const s = inMap ? orderSkeleton(v) : KEEP.has(k) && (typeof v === 'string' || typeof v === 'boolean') ? v : SUBS.has(k) ? orderSkeleton(v, ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'].includes(k)) : 0
    Object.defineProperty(out, k, { value: s, enumerable: true, writable: true, configurable: true })
  }
  return out
}

// Whether the errors of a schema can come out of the IR in an order other
// than schema declaration order, so that the module must sort them. The IR
// writes each node's keywords in the order they are declared, and a
// reference's target where the reference stands, so they can not only where
// a loop over the instance repeats a body that fails in more than one place
// (every item's type before any item's pattern, in schema order; a body
// behind a reference counts as such), and wherever this check does not look
// further: dynamic references, branches, conditionals, annotations collected
// across keywords. Erring towards true costs size, never order.
const ALWAYS = new Set(['$dynamicRef', '$recursiveRef', 'anyOf', 'oneOf', 'if', 'unevaluatedProperties', 'unevaluatedItems', 'dependentSchemas', 'dependencies', 'contains', 'propertyNames', 'patternProperties'])
const LOOPS = new Set(['items', 'prefixItems', 'additionalItems', 'additionalProperties'])
function failPlaces (s) {
  if (s === false) return 1
  if (s === null || typeof s !== 'object') return 0
  if (Array.isArray(s)) { let n = 0; for (const x of s) n += failPlaces(x); return n }
  let n = 0
  for (const k of Object.keys(s)) {
    if (ANNOTATIONS.has(k) || k === '$defs' || k === 'definitions' || k === '$id' || k === '$anchor' || k === '$dynamicAnchor' || k === '$comment' || k === '$schema') continue
    // A reference can fail anywhere its target can: counted as several.
    if (k === '$ref' || k === '$dynamicRef' || k === '$recursiveRef') { n += 2; continue }
    if (k === 'properties' || k === 'patternProperties' || k === 'dependentSchemas') { for (const x of Object.values(s[k] || {})) n += failPlaces(x); continue }
    if (k === 'allOf' || k === 'anyOf' || k === 'oneOf' || k === 'prefixItems' || k === 'items' || k === 'additionalItems' || k === 'additionalProperties' || k === 'not' || k === 'contains' || k === 'propertyNames' || k === 'if' || k === 'then' || k === 'else') { n += k === 'not' ? 1 : Math.max(1, failPlaces(s[k])); continue }
    n++
  }
  return n
}
export function needsOrder (s) {
  if (s === null || typeof s !== 'object') return false
  if (Array.isArray(s)) return s.some(needsOrder)
  for (const k of Object.keys(s)) {
    if (ALWAYS.has(k)) return true
    if (LOOPS.has(k) && failPlaces(s[k]) > 1) return true
  }
  for (const k of Object.keys(s)) {
    if (ANNOTATIONS.has(k) && k !== 'default') continue
    if (k === 'enum' || k === 'const' || k === 'default' || k === 'required' || k === 'examples') continue
    if (needsOrder(s[k])) return true
  }
  return false
}
