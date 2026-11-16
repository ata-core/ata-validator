'use strict'

// The parts of the verdict core (lib/core/verdict.js) a schema needs only
// when it has unevaluatedProperties or unevaluatedItems, a $dynamicRef, or an
// object with more than 16 declared names, an array with prefixItems,
// contains or uniqueItems, or an object compared with a constant. Loaded the first time a schema
// needs one of them, so a page whose schemas need none does not carry them.

const { has, isArr, isMap, keysOf, names, get, ref, Ctx, pattern, bits, O_, valueAt, REQ, propEnum, visit, resolveRef, splitFragment, resolveUri, absent, exactObj, lenOk, sub, inline, leafOk, tagOf } = require('./verdict')._i
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

// unevaluatedProperties and unevaluatedItems. Below a node that has one,
// its in-place subschemas ($ref, $dynamicRef, allOf, anyOf, oneOf, if, then,
// else, dependentSchemas, propertyDependencies) run in a second compiled
// form that checks and, in the same pass, records what it evaluated: the
// node's own names, patterns, prefix length and whole-object or whole-array
// keywords as one record, and the indexes contains matched. The records go
// on one stack; a branch that fails is cut off it, so only what passing
// subschemas evaluated is read when the keyword is checked. Every other
// subschema, and every schema without these keywords, keeps its one form.
// The stacks and their tops: an entry above the top is stale.
const EP = []
const EC = []
const EK = []
let np = 0
let nc = 0
let nk = 0
const NONE = new Set()
const ALL_P = { allP: true, allI: false, names: NONE, list: [], pats: [], upto: 0 }
const ALL_I = { allP: false, allI: true, names: NONE, list: [], pats: [], upto: 0 }
const ET = () => true
const EF = () => false
// The keywords the second form reads itself; the rest of the node is
// compiled as usual and asked first.
const OWN = new Set(['$ref', '$dynamicRef', 'allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', 'dependentSchemas', 'propertyDependencies', 'contains', 'minContains', 'maxContains', 'unevaluatedProperties', 'unevaluatedItems'])

// The check of a node with unevaluated*: `f0` is its check without them.
// Where what it evaluates depends on the value (a branch, contains), the
// node runs in the recording form; else against its fixed plan.
function unevaluatedNode (V, s, f0, U, alone) {
  const P = U.P = plan(V, s, true, [])
  // Also where a subschema brings patterns: there it records the names they
  // matched, and they are not asked again.
  const ownPats = isMap(s.patternProperties) ? names(s.patternProperties).length : 0
  if (P.dyn.length !== 0 || P.contains.length !== 0 || P.pats.length > ownPats) return evTop(V, s)
  // Fixed: the names, patterns and prefix read once here.
  const up = P.allP ? undefined : U.up, ui = P.allI ? undefined : U.ui, upto = P.upto
  // The node's own patternProperties (with no additionalProperties, which
  // reads them, and no reference, compiled against the node itself) are
  // asked in the same loop as unevaluatedProperties, each pattern once per
  // name, and left out of the node's check.
  let own = null, ownF = null
  if (up !== undefined && isMap(s.patternProperties) && s.additionalProperties === undefined && s.$ref === undefined && s.$dynamicRef === undefined) {
    own = names(s.patternProperties)
    const rest = {}
    for (const k in s) if (k !== 'patternProperties' && k !== 'unevaluatedProperties' && k !== 'unevaluatedItems' && k !== '__proto__' && s[k] !== undefined) rest[k] = s[k]
    f0 = get(V, rest)
    alone = false
    ownF = own.map(() => null)
  }
  const ownR = own === null ? null : own.map(pattern)
  const ns = P.names.size === 0 ? null : P.names
  const rem = own === null ? P.pats : P.pats.slice(own.length)
  const ps = rem.length === 0 ? null : rem
  let upf = up === false ? F : null, uif = ui === false ? F : null
  const g = (d) => {
    if (up !== undefined && typeof d === 'object' && d !== null && !isArr(d)) {
      // Own enumerable names: an inherited one is not unevaluated.
      const ks = keysOf(d)
      for (let i = 0; i < ks.length; i++) {
        const k = ks[i]
        if (ownR !== null) {
          let m = false
          for (let j = 0; j < ownR.length; j++) if (ownR[j].test(k)) { m = true; if (!(ownF[j] || (ownF[j] = get(V, s.patternProperties[own[j]])))(d[k])) return false }
          if (m) continue
        }
        if (ns !== null && ns.has(k)) continue
        if (ps !== null) { let m = false; for (let j = 0; j < ps.length && !m; j++) m = ps[j].test(k); if (m) continue }
        if (!(upf || (upf = get(V, up)))(d[k])) return false
      }
    } else if (ui !== undefined && isArr(d)) {
      for (let i = upto; i < d.length; i++) if (!(uif || (uif = get(V, ui)))(d[i])) return false
    }
    return true
  }
  // unevaluatedProperties: false where nothing is evaluated: an object has
  // no own enumerable names.
  const h = up === false && ui === undefined && ownR === null && ns === null && ps === null ? (d) => typeof d !== 'object' || d === null || isArr(d) || keysOf(d).length === 0 : g
  return alone ? h : (d) => f0(d) && h(d)
}
const F = () => false

// A node with unevaluated* as the rest of the tree calls it: the stack is
// left as it was found.
function evTop (V, s) {
  const w = evOf(V, s)
  let f = null
  return (d) => {
    const p0 = np, c0 = nc, k0 = nk
    try { return (f || (f = w.built()))(d) } finally { np = p0; nc = c0; nk = k0 }
  }
}

function evOf (V, s) {
  if (!isMap(s)) return s === false ? EF : ET
  if (V.dyn !== null) V = enter(V, s)
  const m = V.evs || (V.evs = new WeakMap())
  let f = m.get(s)
  if (f === undefined) {
    let g = null
    const built = () => g || (g = evBuild(V, s))
    f = (d) => (g || built())(d)
    f.built = built
    m.set(s, f)
  }
  return f
}

function evBuild (V, s) {
  const rest = {}
  let restN = 0
  let rf, drf, all, any, one, iff, then, els, ds, pd, ct, mic, mac, up, ui, pp, naming
  for (const k in s) {
    const v = s[k]
    if (v === undefined) continue
    if (!OWN.has(k)) {
      // patternProperties without additionalProperties: the node tests the
      // patterns itself and records the names they matched.
      if (k === 'patternProperties' && isMap(v) && s.additionalProperties === undefined) { pp = v; continue }
      // properties that only name (each schema true or empty) check nothing
      // where no additionalProperties reads them: they stay in the record.
      if (k === 'properties' && isMap(v) && s.additionalProperties === undefined && names(v).every((n) => trivial(v[n]))) { naming = v; continue }
      if (k !== '__proto__') { rest[k] = v; restN++ }
      continue
    }
    switch (k) {
      case '$ref': if (typeof v === 'string' && V.targets !== null) rf = V.targets.get(s); break
      case '$dynamicRef': if (typeof v === 'string' && V.dyn !== null) drf = dynamicTarget(V, V.dyn.refs.get(s)); break
      case 'allOf': if (isArr(v)) all = v; break
      case 'anyOf': if (isArr(v)) any = v; break
      case 'oneOf': if (isArr(v)) one = v; break
      case 'if': iff = v; break
      case 'then': then = v; break
      case 'else': els = v; break
      case 'dependentSchemas': if (isMap(v)) ds = v; break
      case 'propertyDependencies': if (isMap(v)) pd = v; break
      case 'contains': ct = v; break
      case 'minContains': mic = v; break
      case 'maxContains': mac = v; break
      case 'unevaluatedProperties': up = v; break
      case 'unevaluatedItems': ui = v
    }
  }
  // required alone: own names that are not undefined, asked directly. Beside
  // other keywords, the name-only properties go back, as the core checks
  // required names fastest where they are declared.
  let base
  if (restN === 1 && allStrList(rest.required)) {
    const rq = rest.required
    base = (d) => { if (typeof d !== 'object' || d === null || isArr(d)) return true; for (let i = 0; i < rq.length; i++) if (!has(d, rq[i]) || d[rq[i]] === undefined) return false; return true }
  } else {
    if (naming !== undefined && rest.required !== undefined) { rest.properties = naming; restN++ }
    base = restN === 0 ? null : get(V, rest)
  }
  // What the node's own keywords evaluate when it passes.
  let own = null
  {
    const ns = isMap(s.properties) ? new Set(names(s.properties)) : NONE
    const ps = pp === undefined && isMap(s.patternProperties) ? names(s.patternProperties).map(pattern) : []
    const upto = isArr(s.prefixItems) ? s.prefixItems.length : 0
    const allP = s.additionalProperties !== undefined, allI = s.items !== undefined
    // A few names are compared in a list rather than looked up.
    if (ns.size !== 0 || ps.length !== 0 || upto !== 0 || allP || allI) own = { allP, allI, names: ns, list: ns.size <= 4 ? [...ns] : null, pats: ps, upto }
  }
  // Children are compiled when this node first runs, and called directly
  // from then on.
  const built = (c) => { const w = evOf(V, c); return w.built === undefined ? w : w.built() }
  const sr = []
  if (rf !== undefined) sr.push(rf)
  if (drf !== undefined) sr.push(drf)
  if (all !== undefined) for (const c of all) sr.push(c)
  let steps = null, anyF = null, oneF = null, ifF = null, thenF = null, elsF = null, dsF = null, pdF = null
  let ctf = null, upf = null, uif = null, oneU = null
  // Branches told apart by a required string constant of one property: the
  // value names the only branch that can pass.
  const tagAny = any === undefined ? null : tagOf(any), tagOne = one === undefined ? null : tagOf(one)
  const tagged = (t, d) => {
    if (typeof d !== 'object' || d === null || isArr(d)) return -1
    const v = d[t[0]], vs = t[1]
    for (let i = 0; i < vs.length; i++) if (vs[i] === v) return i
    return -1
  }
  const cmin = mic === undefined ? 1 : mic
  const ppn = pp === undefined ? null : names(pp), ppr = ppn === null ? null : ppn.map(pattern), ppf = ppn === null ? null : ppn.map(() => null)
  const objParts = ds !== undefined || pd !== undefined || up !== undefined || pp !== undefined
  const arrParts = ct !== undefined || ui !== undefined
  let f
  if (sr.length === 0 && any === undefined && one === undefined && iff === undefined && !objParts && !arrParts) {
    // Only what the node's own keywords evaluate.
    f = own === null ? (base === null ? ET : base) : base === null ? (d) => { EP[np++] = own; return true } : (d) => { if (!base(d)) return false; EP[np++] = own; return true }
  } else if (sr.length === 0 && any === undefined && one === undefined && iff === undefined && !arrParts && ds === undefined && pd === undefined && up === undefined) {
    // patternProperties alone: the names they matched are recorded.
    f = (d) => {
      if (base !== null && !base(d)) return false
      if (own !== null) EP[np++] = own
      if (typeof d !== 'object' || d === null || isArr(d)) return true
      const ks = keysOf(d)
      for (let i = 0; i < ks.length; i++) {
        const k = ks[i]
        let m = false
        for (let j = 0; j < ppr.length; j++) if (ppr[j].test(k)) { m = true; if (!(ppf[j] || (ppf[j] = get(V, pp[ppn[j]])))(d[k])) return false }
        if (m) EK[nk++] = k
      }
      return true
    }
  } else if (sr.length === 0 && any === undefined && one === undefined && iff === undefined && !objParts && ui === undefined) {
    // contains alone: the indexes it matched are recorded.
    f = (d) => {
      if (base !== null && !base(d)) return false
      if (own !== null) EP[np++] = own
      if (!isArr(d)) return true
      if (ctf === null) ctf = get(V, ct)
      let c = 0
      for (let i = 0; i < d.length; i++) if (ctf(d[i])) { c++; EC[nc++] = i }
      return c >= cmin && (mac === undefined || c <= mac)
    }
  } else {
    let ready = false
    const resolve = () => {
      steps = sr.map(built)
      if (any !== undefined) anyF = any.map(built)
      if (one !== undefined) oneF = one.map(built)
      if (iff !== undefined) { ifF = built(iff); if (then !== undefined) thenF = built(then); if (els !== undefined) elsF = built(els) }
      if (ds !== undefined) dsF = Object.entries(ds).map((p) => [p[0], built(p[1])])
      if (pd !== undefined) pdF = Object.entries(pd).filter((p) => isMap(p[1])).map((p) => [p[0], new Map(Object.entries(p[1]).map((q) => [q[0], built(q[1])]))])
      ready = true
    }
    f = (d) => {
      if (base !== null && !base(d)) return false
      if (!ready) resolve()
      const p0 = np, c0 = nc, k0 = nk
      if (own !== null) EP[np++] = own
      for (let i = 0; i < steps.length; i++) if (!steps[i](d)) return false
      if (tagAny !== null) {
        const i = tagged(tagAny, d)
        if (i < 0 || !anyF[i](d)) return false
      } else if (anyF !== null) {
        let n = 0
        for (let i = 0; i < anyF.length; i++) {
          const p1 = np, c1 = nc, k1 = nk
          if (anyF[i](d)) n++
          else { np = p1; nc = c1; nk = k1 }
        }
        if (n === 0) return false
      }
      if (tagOne !== null) {
        const i = tagged(tagOne, d)
        if (i < 0 || !oneF[i](d)) return false
      } else if (oneF !== null) {
        // Many branches: the usual oneOf check (with its shortcuts) says
        // whether exactly one passes, and the branches then run in this form
        // until that one is met. A few: each runs in this form, counted.
        const many = oneF.length > 4
        if (many && !(oneU || (oneU = get(V, { oneOf: one })))(d)) return false
        let n = 0
        for (let i = 0; i < oneF.length && !(many && n === 1); i++) {
          const p1 = np, c1 = nc, k1 = nk
          if (oneF[i](d)) { if (++n > 1) return false } else { np = p1; nc = c1; nk = k1 }
        }
        if (n === 0) return false
      }
      if (ifF !== null) {
        const p1 = np, c1 = nc, k1 = nk
        if (ifF(d)) { if (thenF !== null && !thenF(d)) return false } else {
          np = p1; nc = c1; nk = k1
          if (elsF !== null && !elsF(d)) return false
        }
      }
      if (objParts && typeof d === 'object' && d !== null && !isArr(d)) {
        if (ppr !== null) {
          const ks = keysOf(d)
          for (let i = 0; i < ks.length; i++) {
            const k = ks[i]
            let m = false
            for (let j = 0; j < ppr.length; j++) if (ppr[j].test(k)) { m = true; if (!(ppf[j] || (ppf[j] = get(V, pp[ppn[j]])))(d[k])) return false }
            if (m) EK[nk++] = k
          }
        }
        if (dsF !== null) for (let i = 0; i < dsF.length; i++) if (has(d, dsF[i][0]) && !dsF[i][1](d)) return false
        if (pdF !== null) {
          for (let i = 0; i < pdF.length; i++) {
            const k = pdF[i][0]
            if (!has(d, k) || typeof d[k] !== 'string') continue
            const c = pdF[i][1].get(d[k])
            if (c !== undefined && !c(d)) return false
          }
        }
        if (up !== undefined) {
          // Own enumerable names: an inherited one is not unevaluated.
          const ks = keysOf(d)
          for (let i = 0; i < ks.length; i++) {
            const k = ks[i]
            if ((np !== p0 || nk !== k0) && evaluatedName(p0, k0, k)) continue
            if (!(upf || (upf = get(V, up)))(d[k])) return false
          }
          EP[np++] = ALL_P
        }
      } else if (arrParts && isArr(d)) {
        if (ct !== undefined) {
          if (ctf === null) ctf = get(V, ct)
          let c = 0
          for (let i = 0; i < d.length; i++) if (ctf(d[i])) { c++; EC[nc++] = i }
          if (c < cmin || (mac !== undefined && c > mac)) return false
        }
        if (ui !== undefined) {
          let upto = 0, allI = false
          for (let i = p0; i < np && !allI; i++) { const q = EP[i]; if (q.allI) allI = true; else if (q.upto > upto) upto = q.upto }
          if (!allI) {
            for (let i = upto; i < d.length; i++) {
              let ev = false
              for (let j = c0; j < nc && !ev; j++) ev = EC[j] === i
              if (!ev && !(uif || (uif = get(V, ui)))(d[i])) return false
            }
          }
          EP[np++] = ALL_I
        }
      }
      return true
    }
  }
  if (!V.track || (rf === undefined && drf === undefined)) return f
  const st = V.stack
  return (d) => {
    for (let i = st.length - 2; i >= 0; i -= 2) if (st[i] === s && st[i + 1] === d) return true
    st.push(s, d)
    const ok = f(d)
    st.length -= 2
    return ok
  }
}
const allStrList = (v) => isArr(v) && v.every((x) => typeof x === 'string')
function trivial (c) {
  if (c === true) return true
  if (!isMap(c)) return false
  for (const k in c) return false
  return true
}
function evaluatedName (p0, k0, k) {
  for (let i = k0; i < nk; i++) if (EK[i] === k) return true
  for (let i = p0; i < np; i++) {
    const q = EP[i]
    if (q.allP) return true
    const l = q.list
    if (l !== null) { for (let j = 0; j < l.length; j++) if (l[j] === k) return true } else if (q.names.has(k)) return true
    for (let j = 0; j < q.pats.length; j++) if (q.pats[j].test(k)) return true
  }
  return false
}

// What a subschema evaluates when it passes, as far as it is fixed by the
// schema: property names and patterns, a prefix length, contains schemas,
// whether it evaluates every name or index (additionalProperties, items,
// unevaluated* below the top), merged through allOf and $ref. What depends
// on which branch passes (anyOf, oneOf, if, dependentSchemas,
// propertyDependencies) is listed in `dyn`. unevaluatedNode checks a node
// against its plan where nothing depends on the value, and sends it to the
// recording form otherwise. A plan built while a reference cycle was cut is
// not kept, since from another entry the cycle is cut elsewhere.
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
// on the dynamic scope a node is compiled under. Null declines the schema.
function resolveDynamic (st, state, opts, baseOf, visitTarget, targets, done) {
  // $dynamicRef: every target it can take is known here (its initial one
  // and every node declaring the dynamic anchor it names); which one runs
  // depends on the dynamic scope.
  const refs = new Map(), enter = new Map()
  for (let i = 0; i < st.drefs.length; i++) {
    const s = st.drefs[i], b = baseOf(s)
    if (refs.has(s)) continue
    if (b === undefined) return null
    const ref = s.$dynamicRef, r = resolveRef(ref, b, state), frag = splitFragment(resolveUri(b, ref))[1]
    const byAnchor = !!frag && frag[0] !== '/'
    const m0 = state.dynamicAnchors.get(r.base)
    const search = byAnchor && (!!opts.v1 || (r.node !== undefined && m0 !== undefined && m0.get(frag) === r.node))
    if (isMap(r.node)) { if (baseOf(r.node) !== r.base || !visitTarget(r.node)) return null; enter.set(r.node, r.base) }
    const bases = [], nodes = []
    if (search) for (const [base, m] of state.dynamicAnchors) if (m.has(frag)) { const t = m.get(frag); if (!isMap(t) || baseOf(t) !== base || !visitTarget(t)) return null; enter.set(t, base); bases.push(base); nodes.push(t) }
    bases.push(null); nodes.push(r.node === undefined ? undefined : r.node === false ? false : isMap(r.node) ? r.node : true)
    refs.set(s, { search, bases, nodes })
  }
  // Refs found while visiting dynamic targets.
  for (let i = done; i < st.refs.length; i++) {
    const b = baseOf(st.refs[i])
    if (b === undefined) return null
    const r = resolveRef(st.refs[i].$ref, b, state)
    const t = r.node === undefined || r.node === false ? false : isMap(r.node) ? r.node : true
    if (isMap(t) && (baseOf(t) !== r.base || !visitTarget(t))) return null
    targets.set(st.refs[i], t)
  }
  if (st.drefs.some((x) => !refs.has(x))) return null
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

module.exports = { xRecord, extend, enter, dynamicTarget, unevaluatedNode, declaredBig, bigAbsent, resolveDynamic, arrGeneral, eq }
