'use strict'

// The parts of the verdict core (lib/core/verdict.js) a schema needs only
// when it has unevaluatedProperties or unevaluatedItems, a $dynamicRef, or an
// object with more than 16 declared names, an array with prefixItems,
// contains or uniqueItems, or an object compared with a constant. Loaded the first time a schema
// needs one of them, so a page whose schemas need none does not carry them.

const { has, isArr, isMap, keysOf, names, get, ref, Ctx, pattern, bits, O_, valueAt, REQ, propEnum, visit, resolveRef, splitFragment, resolveUri, absent, exactObj, lenOk, sub, inline, leafOk } = require('./verdict')._i
const { _deq: eq, allDistinct } = require('../unique-items')

// The context for the scope extended by a base: a node is compiled once per
// scope it is reached under, and a $dynamicRef in it resolves when compiled.
const extend = (V, b) => { const m = V.kids || (V.kids = new Map()); let c = m.get(b); if (c === undefined) m.set(b, (c = new Ctx(V.targets, V.fmts, V.track, V.dyn, V.scope.concat(b), V.stack))); return c }
const enter = (V, s) => { if (V.dyn === null) return V; const b = V.dyn.enter.get(s); return b === undefined || V.scope.includes(b) ? V : extend(V, b) }


// The target of a $dynamicRef under the scope of `V`: its initial target,
// or, by a fragment that names an anchor (and in 2020-12 only when the
// initial target carries that dynamic anchor itself), the outermost base in
// scope that declares it. False where nothing resolves.
function dynamicTarget (V, D) {
  const nodes = D.nodes, last = nodes.length - 1
  if (D.search) for (const b of V.scope) { const j = D.bases.indexOf(b); if (j >= 0 && j < last) return nodes[j] }
  return nodes[last] === undefined ? false : nodes[last]
}

// ---------- unevaluated ----------

// unevaluatedProperties and unevaluatedItems, checked after the rest of the
// node passed. Which names and indexes the node evaluated follows from its
// subschemas and the value: a subschema that passed evaluates what its own
// keywords name, and among anyOf, oneOf and if, only the branches that pass
// count, which are asked again here. Nothing is collected on the way down,
// so a schema without these keywords pays nothing for them.
const NO_MORE = []
function unevaluated (V, s, U, d) {
  const P = U.P || (U.P = plan(V, s, true, []))
  if (U.up !== undefined && bits(d) === O_ && !P.allP) {
    const more = P.dyn.length === 0 ? NO_MORE : passing(V, P, d, [])
    if (more !== true) {
      // for-in, and an own key only: an inherited one is not unevaluated.
      for (const k in d) {
        if (namesP(P, k)) continue
        let ev = false
        for (let i = 0; i < more.length && !ev; i++) ev = namesP(more[i], k)
        if (!ev && has(d, k) && !(U.upf || (U.upf = get(V, U.up)))(d[k])) return false
      }
    }
  }
  if (U.ui !== undefined && isArr(d) && !P.allI) {
    const more = P.dyn.length === 0 ? NO_MORE : passing(V, P, d, [])
    if (more !== true) {
      let upto = Math.min(d.length, P.upto)
      for (const q of more) upto = Math.max(upto, Math.min(d.length, q.upto))
      for (let i = upto; i < d.length; i++) {
        let ev = containsAt(V, P, d[i])
        for (let j = 0; j < more.length && !ev; j++) ev = containsAt(V, more[j], d[i])
        if (!ev && !(U.uif || (U.uif = get(V, U.ui)))(d[i])) return false
      }
    }
  }
  return true
}
const checkOf = (V, c) => { const m = V.memo || (V.memo = new WeakMap()); let f = isMap(c) ? m.get(c) : undefined; if (f === undefined) { f = get(V, c); if (isMap(c)) m.set(c, f) } return f }
const namesP = (q, k) => { if (q.names.has(k)) return true; for (let i = 0; i < q.pats.length; i++) if (q.pats[i].test(k)) return true; return false }
const containsAt = (V, q, x) => { for (let i = 0; i < q.contains.length; i++) if (checkOf(V, q.contains[i])(x)) return true; return false }

// What a subschema evaluates when it passes, as far as it is fixed by the
// schema: property names and patterns, a prefix length, contains schemas,
// whether it evaluates every name or index (additionalProperties, items,
// unevaluated* below the top), merged through allOf and $ref. What depends
// on which branch passes (anyOf, oneOf, if, dependentSchemas,
// propertyDependencies) is kept in `dyn` and decided per value. A plan
// built while a reference cycle was cut is not kept, since from another
// entry the cycle is cut elsewhere.
const EMPTY_PLAN = { allP: false, allI: false, names: new Set(), pats: [], upto: 0, contains: [], dyn: [], cut: false }
function plan (V, s, top, path) {
  if (V.dyn !== null && isMap(s)) V = enter(V, s)
  const memo = V.plans || (V.plans = new WeakMap())
  const key = top ? (V.tops || (V.tops = new WeakMap())) : memo
  let P = isMap(s) ? key.get(s) : undefined
  if (P !== undefined) return P
  if (!isMap(s)) return EMPTY_PLAN
  P = { allP: false, allI: false, names: new Set(), pats: [], upto: 0, contains: [], dyn: [], cut: false }
  if (path.includes(s)) { P.cut = true; return P }
  path.push(s)
  if ((!top && s.unevaluatedProperties !== undefined) || s.additionalProperties !== undefined) P.allP = true
  if ((!top && s.unevaluatedItems !== undefined) || s.items !== undefined) P.allI = true
  if (isMap(s.properties)) for (const k of names(s.properties)) P.names.add(k)
  if (isMap(s.patternProperties)) for (const k of names(s.patternProperties)) P.pats.push(pattern(k))
  if (isArr(s.prefixItems)) P.upto = s.prefixItems.length
  if (s.contains !== undefined) P.contains.push(s.contains)
  const merge = (c) => {
    const q = plan(V, c, false, path)
    P.allP = P.allP || q.allP; P.allI = P.allI || q.allI; P.cut = P.cut || q.cut
    for (const k of q.names) P.names.add(k)
    P.pats.push(...q.pats); P.contains.push(...q.contains); P.dyn.push(...q.dyn)
    P.upto = Math.max(P.upto, q.upto)
  }
  if (typeof s.$ref === 'string' && V.targets !== null) merge(V.targets.get(s))
  if (typeof s.$dynamicRef === 'string' && V.dyn !== null) merge(dynamicTarget(V, V.dyn.refs.get(s)))
  if (isArr(s.allOf)) for (const c of s.allOf) merge(c)
  // Each branch entry keeps the context it was planned in.
  const at = (x) => { x.V = V; P.dyn.push(x) }
  if (isArr(s.anyOf)) at([0, s.anyOf])
  if (isArr(s.oneOf)) at([1, s.oneOf])
  if (s.if !== undefined) at([2, s.if, s.then, s.else])
  if (isMap(s.dependentSchemas)) for (const p of Object.entries(s.dependentSchemas)) at([3, p[0], p[1]])
  if (isMap(s.propertyDependencies)) for (const p of Object.entries(s.propertyDependencies)) if (isMap(p[1])) at([4, p[0], p[1]])
  path.pop()
  if (!P.cut || top) key.set(s, P)
  return P
}

// The plans of the branches that pass for `d`, followed down through their
// own branches; true when one of them evaluates everything there is. The
// checks and plans of a branch are kept on its entry once made.
function passing (V, P, d, out) {
  for (const x of P.dyn) {
    const k = x[0]
    V = x.V
    if (k === 0 || k === 1) {
      const list = x[1], fs = x.fs || (x.fs = list.map((c) => checkOf(V, c)))
      for (let i = 0; i < list.length; i++) {
        if (!fs[i](d)) continue
        if (take(V, x, i, list[i], d, out)) return true
        if (k === 1) break
      }
    } else if (k === 2) {
      if ((x.fi || (x.fi = checkOf(V, x[1])))(d)) { if (take(V, x, 0, x[1], d, out) || (x[2] !== undefined && take(V, x, 1, x[2], d, out))) return true } else if (x[3] !== undefined && take(V, x, 2, x[3], d, out)) return true
    } else if (bits(d) === O_ && has(d, x[1])) {
      if (k === 3) { if (take(V, x, 0, x[2], d, out)) return true } else { const v = d[x[1]]; if (typeof v === 'string' && has(x[2], v) && take(V, x, -1, x[2][v], d, out)) return true }
    }
  }
  return out
}
function take (V, x, i, c, d, out) {
  const ps = x.ps || (x.ps = [])
  const q = i < 0 ? plan(V, c, false, []) : ps[i] || (ps[i] = plan(V, c, false, []))
  out.push(q)
  return (isArr(d) ? q.allI : q.allP) || (q.dyn.length !== 0 && passing(V, q, d, out) === true)
}


// The same with many declared names, found in a map.
function declaredBig (V, g, props, e, n, nReq, closed, B) {
  return (o) => {
    if (typeof o !== 'object' || o === null || isArr(o)) return !g
    let hits = 0, seen = 0, next = 0, count = 0, last
    for (const k in o) {
      last = k
      count++
      let i = next
      if (e[i] !== k) {
        const j = B.ix.get(k)
        i = j === undefined ? 3 * n : j
        if (i === 3 * n) { if (closed) return has(o, k) ? false : exactObj(V, props, e, n, closed, null, o, B); continue }
      }
      next = i + 3
      hits++
      seen |= 1 << (i / 3)
      const x = o[k]
      if (x === undefined) { if (e[i + 1] >= REQ) return has(o, k) ? false : exactObj(V, props, e, n, closed, null, o, B); continue }
      switch (e[i + 1] & 15) {
        case 1: if (typeof x === 'string') continue; break
        case 2: if (Number.isFinite(x)) continue; break
        case 3: if (Number.isInteger(x)) continue; break
        case 4: if (typeof x === 'boolean') continue; break
        case 5: if (x === null) continue; break
        case 6: continue
        case 7: if (x === e[i + 2]) continue; break
        case 8: { const a = e[i + 2]; if (Number.isInteger(x) && x >= a[0] && x <= a[1]) continue; break }
        case 9: { const a = e[i + 2]; if (Number.isFinite(x) && x >= a[0] && x <= a[1]) continue; break }
        case 10: { const a = e[i + 2]; if (typeof x === 'string' && lenOk(x, a[0], a[1])) continue; break }
        case 11: if (typeof x === 'string' && e[i + 2].includes(x)) continue; break
        case 0: if (e[i + 2](x)) continue; break
        default: if (valueAt(V, props, e, i, x)) continue
      }
      return has(o, k) ? false : exactObj(V, props, e, n, closed, null, o, B)
    }
    // Declared names not met: absent, or own and not enumerable.
    if (hits !== n && !(n > 31 ? bigAbsent(V, props, e, n, B, o, count, last) : absent(V, props, e, n, seen, o, hits))) return false
    return nReq === 0 || last === undefined || has(o, last) || exactObj(V, props, e, n, closed, null, o, B)
  }
}

// The same for an object with many declared names: the required ones are
// asked for by name, and the own names are read for one that is not
// enumerable only when they outnumber the keys the walk met, or when the last
// key met was inherited (then the count does not tell).
function bigAbsent (V, props, e, n, B, o, count, last) {
  for (const j of B.rqs) {
    const k = e[j]
    if (!has(o, k)) return false
    if (!propEnum.call(o, k)) { const x = o[k]; if (x === undefined || !valueAt(V, props, e, j, x)) return false }
  }
  const ns = Object.getOwnPropertyNames(o)
  if (ns.length === count && (last === undefined || has(o, last))) return true
  for (const k of ns) {
    if (propEnum.call(o, k)) continue
    const j = B.ix.get(k)
    if (j === undefined || e[j + 1] >= REQ) continue
    const x = o[k]
    if (x !== undefined && !valueAt(V, props, e, j, x)) return false
  }
  return true
}

// $dynamicRef: every target it can take is known here (its initial one and
// every node declaring the dynamic anchor it names); which one runs depends
// on the dynamic scope a node is compiled under. 1 hands the schema to the
// second half, 2 declines.
function resolveDynamic (st, state, opts, baseOf, visitTarget, targets, done) {
  // $dynamicRef: every target it can take is known here (its initial one
  // and every node declaring the dynamic anchor it names); which one runs
  // depends on the dynamic scope.
  const refs = new Map(), enter = new Map()
  for (let i = 0; i < st.drefs.length; i++) {
    const s = st.drefs[i], b = baseOf(s)
    if (refs.has(s)) continue
    if (b === undefined) return 1
    const ref = s.$dynamicRef, r = resolveRef(ref, b, state), frag = splitFragment(resolveUri(b, ref))[1]
    const byAnchor = !!frag && frag[0] !== '/'
    const m0 = state.dynamicAnchors.get(r.base)
    const search = byAnchor && (!!opts.v1 || (r.node !== undefined && m0 !== undefined && m0.get(frag) === r.node))
    if (isMap(r.node)) { if (baseOf(r.node) !== r.base || !visitTarget(r.node)) return st.walkThrows ? 2 : 1; enter.set(r.node, r.base) }
    const bases = [], nodes = []
    if (search) for (const [base, m] of state.dynamicAnchors) if (m.has(frag)) { const t = m.get(frag); if (!isMap(t) || baseOf(t) !== base || !visitTarget(t)) return st.walkThrows ? 2 : 1; enter.set(t, base); bases.push(base); nodes.push(t) }
    bases.push(null); nodes.push(r.node === undefined ? undefined : r.node === false ? false : isMap(r.node) ? r.node : true)
    refs.set(s, { search, bases, nodes })
  }
  // Refs found while visiting dynamic targets.
  for (let i = done; i < st.refs.length; i++) {
    const b = baseOf(st.refs[i])
    if (b === undefined) return 1
    const r = resolveRef(st.refs[i].$ref, b, state)
    const t = r.node === undefined || r.node === false ? false : isMap(r.node) ? r.node : true
    if (isMap(t) && (baseOf(t) !== r.base || !visitTarget(t))) return st.walkThrows ? 2 : 1
    targets.set(st.refs[i], t)
  }
  if (st.drefs.some((x) => !refs.has(x))) return 1
  for (const t of targets.values()) if (isMap(t)) enter.set(t, baseOf(t))
  for (const [base, node] of state.resources) if (isMap(node) && state.nodeBase.get(node) === base) enter.set(node, base)
  return { refs, enter }
}

// Arrays with prefixItems, contains or uniqueItems.
function arrGeneral (V, g, lo, hi, uq, pre, items, ct, mic, mac) {
  let code = items === undefined ? 6 : -1, it = null
  const pfs = pre === undefined ? null : pre.map(() => null)
  const start = pre === undefined ? 0 : pre.length
  let cf = null
  const cmin = mic === undefined ? 1 : mic
  return (d) => {
    if (!isArr(d)) return !g
    const len = d.length
    if (len < lo || len > hi) return false
    if (uq && !allDistinct(d)) return false
    let i = 0
    for (; i < start && i < len; i++) if (!sub(pfs, pre, i, V)(d[i])) return false
    if (code === -1) { const r = inline(V, items); code = r[0]; it = r[1] }
    if (code !== 6) for (i = start; i < len; i++) if (!leafOk(code, it, d[i])) return false
    if (ct !== undefined) {
      if (cf === null) cf = get(V, ct)
      let c = 0
      for (i = 0; i < len; i++) if (cf(d[i]) && ++c >= cmin && mac === undefined) break
      if (c < cmin || (mac !== undefined && c > mac)) return false
    }
    return true
  }
}

// What an object node rarely has: patternProperties, additionalProperties as
// a schema, propertyNames, property counts, dependencies, propertyDependencies
// and required names that are not declared. The record carries the two
// functions that read it.
function xRecord (ps, pp, ap, closed, pn, mip, map, dr, ds, xr, pd) {
  return {
    res: ps === null ? null : ps.map(pattern), pss: ps === null ? null : ps.map((k) => pp[k]), pfs: ps === null ? null : ps.map(() => null),
    ap: ap === undefined || ap === true || closed ? undefined : ap, apf: null, pn, pnf: null,
    lo: mip === undefined ? 0 : mip, hi: map === undefined ? Infinity : map,
    dr, deps: dr === undefined ? null : names(dr), ds, dss: ds === undefined ? null : names(ds), dsf: ds === undefined ? null : names(ds).map(() => null), xr,
    pd: pd === undefined ? null : Object.entries(pd).filter((p) => isMap(p[1])).map((p) => [p[0], new Map(Object.entries(p[1]).map((q) => [q[0], [q[1], null]]))]),
    key: keyX,
    finish: finishX
  }
}

// One key against patternProperties, additionalProperties and
// propertyNames: -1 when it fails, 1 when evaluated, else 0.
function keyX (V, X, o, k, ev) {
  if (X.res !== null) for (let j = 0; j < X.res.length; j++) if (X.res[j].test(k)) { ev = true; if (!sub(X.pfs, X.pss, j, V)(o[k])) return -1 }
  if (!ev && X.ap !== undefined && !(X.apf || (X.apf = get(V, X.ap)))(o[k])) return -1
  if (X.pn !== undefined && !(X.pnf || (X.pnf = get(V, X.pn)))(k)) return -1
  return ev ? 1 : 0
}

// After the keys: required names that are not declared, dependencies.
function finishX (V, X, o) {
  const xr = X.xr
  if (xr !== null) for (let i = 0; i < xr.length; i++) if (!has(o, xr[i]) || o[xr[i]] === undefined) return false
  if (X.deps !== null) for (const k of X.deps) if (has(o, k)) for (const x of X.dr[k]) if (!has(o, x)) return false
  if (X.dss !== null) for (let i = 0; i < X.dss.length; i++) if (has(o, X.dss[i]) && !(X.dsf[i] || (X.dsf[i] = get(V, X.ds[X.dss[i]])))(o)) return false
  // propertyDependencies: the schema named by the string value of a property.
  if (X.pd !== null) {
    for (const [k, m] of X.pd) {
      if (!has(o, k) || typeof o[k] !== 'string') continue
      const c = m.get(o[k])
      if (c !== undefined && !(c[1] || (c[1] = get(V, c[0])))(o)) return false
    }
  }
  return true
}

module.exports = { xRecord, extend, enter, dynamicTarget, unevaluated, declaredBig, bigAbsent, resolveDynamic, arrGeneral, eq }
