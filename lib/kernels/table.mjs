// The table backend's interpreter: a schema the IR's front end has read,
// written by lib/ir/table.mjs as a plan of steps (one array per schema
// node), and run here. Paths, schema paths, params and messages are made
// from the step and the descriptor it names, as the module writer writes
// them out (lib/ir/emit.mjs), so the errors are the same, field for field and
// in order. A page with many forms carries this once and each form as data.
//
// A step is [handler, ...]: the handler is the function below that runs it,
// named by the plan, so a bundle carries the handlers its plans use and no
// other. A node is an array of steps, run in the schema's own key order; P
// is the plan, its nodes by index, the root first. A handler returns false
// to stop a verdict at its first failure; collecting errors (e an array), it
// pushes them and goes on.
import { own, isObj, keysOf, seg, copyOf, setOwn, E, relate } from './rt.mjs'
import { type, typeP, required, requiredP, additionalProperties, additionalP, not as notK, falseSchema, collapse, branchRank, contains as containsK } from './kernels.mjs'

const PN = ({}).__proto__ === Object.prototype
const NONE = Object.freeze([])
// Whether x is an object with Object.prototype: then a defined value under a
// name Object.prototype lacks is an own property.
const plainOf = (x) => isObj(x) && (PN ? x.__proto__ : Object.getPrototypeOf(x)) === Object.prototype
// A name is present the current engine's way: an own key, and for a name
// Object.prototype lacks on such an object, a defined value.
const has = (x, p, k) => k in Object.prototype ? own(x, k) : p || own(x, k)
// A name as a JSON pointer segment; most names need no escape.
const esc = (k) => k.indexOf('~') === -1 && k.indexOf('/') === -1 ? k : seg(k)
// Paths are built only for a walk that collects errors; a verdict reads none.
const at = (e, a, b) => e === null ? '' : a + b
// A node: by its index in P (shared, or reached again), or written in place.
const nd = (c, r) => typeof r === 'number' ? c.P[r] : r
// Whether the node's properties step (index j, -1 for none) names k, or a
// pattern of its patternProperties (re, compiled once per step) matches it.
const known = (N, j, k, re) => (j !== -1 && own(N[j][1], k)) || (re !== undefined && re.some((r) => r.test(k)))
// A step's pattern sources at t[i], compiled on first use into t[i + 1], as
// the module writer compiles them (a u-flag RegExp).
const pats = (t, i) => t[i] === undefined ? undefined : t[i + 1] !== undefined ? t[i + 1] : (t[i + 1] = t[i].map((p) => new RegExp(p, 'u')))

// [tType, n]
export const tType = (c, t, x, e, s, path, sp, v) => c.T.ok(x, t[1]) || (e !== null && (c.push(e, c.T, path, sp + '/type', t[1], v, s), true))
// [tProps, { name: node, ... }], the schema's own order (the plan writer
// refuses names an object literal would reorder or treat specially).
export function tProps (c, t, x, e, s, path, sp) {
  if (!isObj(x)) return true
  const p = plainOf(x); const l = t[1]
  for (const k in l) {
    const y = x[k]
    if (y !== undefined && has(x, p, k) && !c.run(nd(c, l[k]), y, e, s, at(e, path + '/', esc(k)), at(e, sp + '/properties/', esc(k)), y) && e === null) return false
  }
  return true
}
// [tReq, [name, ...]], or [tReq, mask, the properties step] where the names
// are the properties step's own, in its order: bit i for its i-th name.
export function tReq (c, t, x, e, s, path, sp, v, N) {
  if (!isObj(x)) return true
  const p = plainOf(x)
  const l = typeof t[1] === 'number' ? Object.keys(N[t[2]][1]).filter((_, i) => t[1] >>> i & 1) : t[1]
  for (const r of l) if (x[r] === undefined || !has(x, p, r)) { if (e === null) return false; c.push(e, c.R, path, sp + '/required', r, v, s) }
  return true
}
// additionalProperties false: [tClosed, the node's properties step or -1,
// its patternProperties' patterns when it has any]
export function tClosed (c, t, x, e, s, path, sp, v, N) {
  if (!isObj(x)) return true
  const p = plainOf(x); const re = pats(t, 2)
  for (const k in x) if (!known(N, t[1], k, re) && (p || own(x, k))) { if (e === null) return false; c.push(e, c.A, path, sp + '/additionalProperties', k, v, s) }
  return true
}
// additionalProperties a schema: [tAddl, node, the properties step or -1,
// the patterns when the node has any]
export function tAddl (c, t, x, e, s, path, sp, v, N) {
  if (isObj(x)) { const re = pats(t, 3); for (const k of keysOf(x)) if (!known(N, t[2], k, re) && !c.run(nd(c, t[1]), x[k], e, s, at(e, path + '/', esc(k)), at(e, sp, '/additionalProperties'), x[k]) && e === null) return false }
  return true
}
// patternProperties: [tPats, [[pattern, node], ...]], the object's names in
// Object.keys order, each pattern in the schema's order, a name's value run
// under every pattern that matches it, as the module writer runs them.
export function tPats (c, t, x, e, s, path, sp) {
  if (!isObj(x)) return true
  const l = t[1]; const re = t[2] !== undefined ? t[2] : (t[2] = l.map((p) => new RegExp(p[0], 'u')))
  for (const k of Object.keys(x)) for (let j = 0; j < l.length; j++) if (re[j].test(k) && !c.run(nd(c, l[j][1]), x[k], e, s, at(e, path + '/', esc(k)), at(e, sp + '/patternProperties/', esc(l[j][0])), x[k]) && e === null) return false
  return true
}
// propertyNames: [tPropNames, node]. The name is checked; the errors report
// the object, at its own path.
export function tPropNames (c, t, x, e, s, path, sp, v) {
  if (!isObj(x)) return true
  for (const k of Object.keys(x)) if (!c.run(nd(c, t[1]), k, e, s, path, sp + '/propertyNames', x) && e === null) return false
  return true
}
// A leaf: [tLeaf, descriptor, n], or for a format [tLeaf, descriptor, n,
// check, code, hint]. A descriptor that prepares its argument (pattern) has
// it prepared on first use, kept as t[3].
export function tLeaf (c, t, x, e, s, path, sp, v) {
  const K = t[1]
  if (K.on && !K.on(x)) return true
  if (t.length < 4) t[3] = K.prepare ? K.prepare(t[2]) : t[2]
  const f = K.fail ? K.fail(x, t[2]) : K.ok(x, t[3]) ? null : 0
  if (f === null) return true
  if (e === null) return false
  c.push(e, K, path, sp + '/' + K.kw, t[2], v, s, f || null, t[4], t[5])
  return true
}
// [tItems, node, first index]
export function tItems (c, t, x, e, s, path, sp) {
  if (Array.isArray(x)) for (let j = t[2]; j < x.length; j++) if (!c.run(nd(c, t[1]), x[j], e, s, at(e, path + '/', j), at(e, sp, '/items'), x[j]) && e === null) return false
  return true
}
// [tTuple, [node, ...]]
export function tTuple (c, t, x, e, s, path, sp) {
  if (Array.isArray(x)) for (let j = 0; j < t[1].length && j < x.length; j++) if (!c.run(nd(c, t[1][j]), x[j], e, s, at(e, path + '/', j), at(e, sp + '/prefixItems/', j), x[j]) && e === null) return false
  return true
}
// A call on the same value through $ref or allOf that comes back to a node
// already running on it is cut, the inner entry adding no error, as the
// current engine cuts it.
function here (c, n, x, e, s, path, sp, v) {
  let on = c.a.get(n)
  if (on === undefined) c.a.set(n, on = new Set())
  if (on.has(x)) return true
  on.add(x)
  try { return c.run(nd(c, n), x, e, s, path, sp, v) } finally { on.delete(x) }
}
// [tAll, [node, ...]]
export function tAll (c, t, x, e, s, path, sp, v) {
  for (let j = 0; j < t[1].length; j++) if (!here(c, t[1][j], x, e, s, path, at(e, sp + '/allOf/', j), v) && e === null) return false
  return true
}
// $ref: [tRef, node], same value, same paths.
export const tRef = (c, t, x, e, s, path, sp, v) => here(c, t[1], x, e, s, path, sp, v) || e !== null
// anyOf: [tAny, [node, ...], [title, ...]]. A verdict stops at the first
// branch that passes. Collecting errors, each branch fills a list of its own
// and the first that passes ends it, so no branch runs twice; when none
// passes, the current engine's collapse names the closest branch and its
// errors (lib/branch-collapse.js), pushed as the module writer pushes it.
export function tAny (c, t, x, e, s, path, sp, v) {
  const l = t[1]
  if (e === null) {
    for (let j = 0; j < l.length; j++) if (c.run(nd(c, l[j]), x, null, s, '', '', v)) return true
    return false
  }
  const br = []
  for (let j = 0; j < l.length; j++) {
    const be = []
    c.run(nd(c, l[j]), x, be, s, path, sp + '/anyOf/' + j, v)
    if (be.length === 0) return true
    br.push({ valid: false, errors: be })
  }
  const r = collapse('anyOf', br, path, sp + '/anyOf', null, t[2])
  if (r !== null) c.pushB(e, r, 'anyOf', path, sp + '/anyOf', v, s)
  return true
}
// oneOf: [tOne, [node, ...], [title, ...]]. The verdict first, from the
// count of branches that pass; the branches' errors are built only when the
// keyword fails, each branch run again with a list, and the collapse answers
// the one error: too many branches, or none and the closest.
export function tOne (c, t, x, e, s, path, sp, v) {
  const l = t[1]
  let n = 0
  for (let j = 0; j < l.length; j++) if (c.run(nd(c, l[j]), x, null, s, '', '', v)) n++
  if (n === 1) return true
  if (e === null) return false
  const br = []
  for (let j = 0; j < l.length; j++) {
    const be = []
    c.run(nd(c, l[j]), x, be, s, path, sp + '/oneOf/' + j, v)
    br.push({ valid: be.length === 0, errors: be })
  }
  const r = collapse('oneOf', br, path, sp + '/oneOf', null, t[2])
  if (r !== null) c.pushB(e, r, 'oneOf', path, sp + '/oneOf', v, s)
  return true
}
// Made in a pure call, so a bundle whose plans have no `not` drops it: a
// property read at the top level would be kept.
const NOT = /* @__PURE__ */ (() => ({ kw: 'not', code: notK.code, rank: notK.rank, params: () => ({}), msg: () => notK.msg, exp: () => void 0 }))()
// [tNot, node]
export function tNot (c, t, x, e, s, path, sp, v) {
  if (!c.run(nd(c, t[1]), x, null, true, path, sp + '/not', v)) return true
  if (e === null) return false
  c.push(e, NOT, path, sp + '/not', 0, v, s)
  return true
}
// [tIf, if node, then node or -1, else node or -1]
export function tIf (c, t, x, e, s, path, sp, v) {
  // The branch by the condition's answer, not by which node it is: then and
  // else may be the same schema.
  const ok = c.run(nd(c, t[1]), x, null, true, path, sp + '/if', v); const b = ok ? t[2] : t[3]
  return b === -1 || c.run(nd(c, b), x, e, s, path, sp + (ok ? '/then' : '/else'), v) || e !== null
}
// contains: [tContains, node, minContains, maxContains or -1]. The items
// that pass are counted as verdicts; the keyword reports its own error, with
// the module writer's params and message, when the count is under the
// minimum or over the maximum.
const CONTAINS = /* @__PURE__ */ (() => ({ kw: 'contains', code: containsK.code, rank: containsK.rank, params: () => ({}), msg: () => '', exp: () => void 0 }))()
export function tContains (c, t, x, e, s, path, sp, v) {
  if (!Array.isArray(x)) return true
  let n = 0
  for (let j = 0; j < x.length; j++) if (c.run(nd(c, t[1]), x[j], null, s, '', '', x[j])) n++
  const min = t[2]; const max = t[3]
  if (n < min) {
    if (e === null) return false
    c.push(e, CONTAINS, path, sp + '/contains', 0, v, s, { params: { minContains: min }, msg: `must contain at least ${min} valid item(s)` })
  }
  if (max !== -1 && n > max) {
    if (e === null) return false
    c.push(e, CONTAINS, path, sp + '/contains', 0, v, s, { params: { minContains: min, maxContains: max }, msg: `must NOT contain more than ${max} valid item(s)` })
  }
  return true
}
// dependentSchemas: [tDepSch, [name, node, ...]]: each schema runs on the
// object itself, at its path, when the name is the object's own.
export function tDepSch (c, t, x, e, s, path, sp, v) {
  if (!isObj(x)) return true
  for (let j = 0, l = t[1]; j < l.length; j += 2) if (own(x, l[j]) && !c.run(nd(c, l[j + 1]), x, e, s, path, at(e, sp + '/dependentSchemas/', esc(l[j])), v) && e === null) return false
  return true
}
// propertyDependencies: [tPropDeps, [[name, [value, node, ...]], ...]]: the
// schema under the value the object's own name holds, when it is a string
// and one the map lists, run on the object itself at its path.
export function tPropDeps (c, t, x, e, s, path, sp, v) {
  if (!isObj(x)) return true
  for (let i = 0, m = t[1]; i < m.length; i++) {
    const key = m[i][0]
    if (!own(x, key)) continue
    const val = x[key]
    if (typeof val !== 'string') continue
    const l = m[i][1]
    for (let j = 0; j < l.length; j += 2) if (l[j] === val) { if (!c.run(nd(c, l[j + 1]), x, e, s, path, at(e, sp + '/propertyDependencies/' + esc(key) + '/', esc(val)), v) && e === null) return false; break }
  }
  return true
}
// dependentRequired: [tDepReq, [name, [required, ...], ...]]
export function tDepReq (c, t, x, e, s, path, sp, v) {
  if (!isObj(x)) return true
  const p = plainOf(x)
  for (let j = 0, l = t[1]; j < l.length; j += 2) if (own(x, l[j])) for (const r of l[j + 1]) if (x[r] === undefined || !has(x, p, r)) { if (e === null) return false; c.push(e, c.R, path, sp + '/dependentRequired', r, v, s, null, 'ATA7005') }
  return true
}
const FALSE = /* @__PURE__ */ (() => ({ kw: falseSchema.keyword, code: falseSchema.code, rank: falseSchema.rank, params: () => ({}), msg: () => falseSchema.msg, exp: () => void 0 }))()
// The false schema: [tFalse]
export const tFalse = (c, t, x, e, s, path, sp, v) => e !== null && (c.push(e, FALSE, path, sp, 0, v, s), true)

// push(e, descriptor, path, schemaPath, n, value, seen, failure, code, hint)
// order: the errors into schema order (kernels.mjs ordered), where the
// module writer sorts them too (lib/ir/front.mjs needsOrder).
// pushB(e, collapsed, keyword, path, schemaPath, value, seen): the one error
// of a failed anyOf or oneOf, in the list's shape.
function make (P, F, push, pushB, post, T, R, A, fill, order) {
  const c = {
    P, push, pushB, T, R, A, a: new Map(),
    run (N, x, e, s, path, sp, v) {
      for (let i = 0; i < N.length; i++) if (!N[i][0](c, N[i], x, e, s, path, sp, v, N)) return false
      return true
    },
  }
  const isValid = (d) => { if (fill) fill(F, 0, d); return c.run(P[0], d, null, true, '', '#', d) }
  // isValidObject: the name the build plugin's wrapper reads, so a plan it
  // places needs no wrapper of its own.
  return {
    isValid,
    isValidObject: isValid,
    validate (d) {
      if (fill) fill(F, 0, d)
      if (c.run(P[0], d, null, true, '', '#', d)) return { valid: true, data: d, errors: NONE }
      const e = []
      c.run(P[0], d, e, !(!d && d !== 0 && d !== false), '', '#', d)
      const o = order ? order(e) : e
      return { valid: false, errors: post !== null && o.length > 1 ? post(o) : o }
    },
  }
}

// Defaults, for a plan whose schema has any: F, by index, holds for each
// node [defaults [k, v, ...], properties [k, f, ...], prefixItems [f or -1,
// ...], items f or -1, dependentSchemas [k, f, ...], in place [f, ...]], in
// the order and by the rules of the module writer's fill (lib/ir/front.mjs).
export function tableFill (F, f, d) {
  if (typeof d !== 'object' || d === null) return
  const [defs, props, tuple, each, deps, here] = F[f]
  // `properties` applies to objects, and so do the defaults under it.
  if (!Array.isArray(d)) {
    for (let j = 0; j < defs.length; j += 2) if (!own(d, defs[j])) setOwn(d, defs[j], copyOf(defs[j + 1]))
    for (let j = 0; j < props.length; j += 2) if (own(d, props[j])) tableFill(F, props[j + 1], d[props[j]])
  }
  if (Array.isArray(d) && (tuple.length || each !== -1)) for (let j = 0; j < d.length; j++) { if (j < tuple.length) { if (tuple[j] !== -1) tableFill(F, tuple[j], d[j]) } else if (each !== -1) tableFill(F, each, d[j]) }
  for (let j = 0; j < deps.length; j += 2) if (!Array.isArray(d) && own(d, deps[j])) tableFill(F, deps[j + 1], d)
  for (const g of here) tableFill(F, g, d)
}

// The errors as the plain shape: what richErrors: false gives.
export const tablePlain = (P, F = [], fill, order) => make(P, F, (e, K, path, sp, n, v, s, f) => { e.push({ keyword: K.kw, instancePath: path, schemaPath: sp, params: f ? f.params : K.params(n), message: f ? f.msg : K.msg(n) }) }, (e, r) => { e.push(r) }, null, typeP, requiredP, additionalP, fill, order)
// The errors as ata's rich shape (rt.mjs E); `rel` when a node has both
// required and additionalProperties, whose errors may point at each other.
export const tableRich = (P, F = [], fill, rel, order) => make(P, F, (e, K, path, sp, n, v, s, f, code, hint) => { e.push(E(code || K.code, K.kw, path, sp, f ? f.params : K.params(n), f ? f.msg : K.msg(n), K.exp(n), K.rank, v, s, K.detail, hint || K.suggest)) }, (e, r, kw, path, sp, v, s) => { e.push(E(r.code, kw, path, sp, r.params, r.message, void 0, branchRank, v, s, void 0, void 0, r.branchErrors)) }, rel ? relate : null, type, required, additionalProperties, fill, order)
