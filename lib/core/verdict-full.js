'use strict'

// The verdict core's second half, loaded only for a schema the first half
// (lib/core/verdict.js) does not take: embedded $id resources, references
// into registered documents or that do not resolve, $dynamicRef (and the
// $recursiveRef the Validator rewrites into one), unevaluatedProperties and
// unevaluatedItems, propertyDependencies, and keyword values of unusual
// types. It answers as the interpreter's walk does, keyword for keyword, as a
// tree of closures built once, with three things the first half never needs:
//
// - The base URI of the resource a node is in, which decides where a
//   reference lands. Only a resource root changes it.
// - The dynamic scope, a stack of the bases entered, read by $dynamicRef. It
//   is kept only when the schema holds a $dynamicRef.
// - Annotations: the property names and item indexes a node evaluated,
//   collected only under a node with unevaluated*. A branch that fails
//   contributes none.
//
// Every reference node keeps the interpreter's guard against a (node, value)
// pair met again on the way down.

const { indexSchemas, resolveRef, splitFragment, resolveUri } = require('../engine-shared')
const { _deq: eq, allDistinct } = require('../unique-items')

const has = Object.hasOwn
const isArr = Array.isArray
const isObj = (v) => typeof v === 'object' && v !== null && !isArr(v)
const propEnum = Object.prototype.propertyIsEnumerable
const S_ = 1, N_ = 2, I_ = 4, B_ = 8, Z_ = 16, O_ = 32, A_ = 64
const BIT = { string: S_, number: N_, integer: I_, boolean: B_, null: Z_, object: O_, array: A_ }
const bits = (d) => {
  switch (typeof d) {
    case 'string': return S_
    case 'number': return Number.isFinite(d) ? Number.isInteger(d) ? N_ | I_ : N_ : 0
    case 'boolean': return B_
    case 'object': return d === null ? Z_ : isArr(d) ? A_ : O_
  }
  return 0
}
const cpLen = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { if (((s.charCodeAt(i) - 0xd800) >>> 0) < 0x400 && i + 1 < s.length) i++; n++ } return n }
const cpAtLeast = (s, m) => s.length >= 2 * m || (s.length >= m && cpLen(s) >= m)
const cpAtMost = (s, m) => s.length <= m || (s.length <= 2 * m + 1 && cpLen(s) <= m)
const multipleOk = (d, m) => { if (m === 0) return false; const q = d / m; return Number.isInteger(q) || Math.abs(q - Math.round(q)) < 1e-9 }
const count = (d) => { let n = 0; for (const k of Object.getOwnPropertyNames(d)) if (propEnum.call(d, k)) n++; return n }
const T = () => true
const F = () => false

// Annotations: { p: Set of names or null, i: Set of indexes or null }. NONE
// is the sink of a node whose annotations nobody reads; it is never written.
const NONE = { p: null, i: null }
const merge = (a, b) => {
  if (b.p) { if (!a.p) a.p = new Set(); for (const x of b.p) a.p.add(x) }
  if (b.i) { if (!a.i) a.i = new Set(); for (const x of b.i) a.i.add(x) }
}
const addP = (a, k) => { (a.p || (a.p = new Set())).add(k) }
const addI = (a, i) => { (a.i || (a.i = new Set())).add(i) }

// Whether a $dynamicRef appears anywhere in a document.
const holds = (x, depth) => {
  if (typeof x !== 'object' || x === null || depth > 1000) return false
  if (!isArr(x) && typeof x.$dynamicRef === 'string') return true
  for (const k in x) if (holds(x[k], depth + 1)) return true
  return false
}

// pattern(src) and format(name) are the first half's, so both halves match a
// pattern and look up a format the same way.
function createFull (root, opts, pattern, format) {
  const bookending = !opts.v1
  const state = indexSchemas(root, opts.schemaMap, opts.flat === true)
  const top = state.rootBase
  // The dynamic scope is kept only where a $dynamicRef can read it: in this
  // document or a registered one.
  const dynamic = holds(root, 0) || (opts.schemaMap ? [...opts.schemaMap.values()].some((x) => holds(x, 0)) : false)
  // Whether any node built so far reads annotations. A node is built before
  // it first runs, so the flag is set before anything under such a node is
  // asked for them; until then none are collected.
  let track = false
  const ann = () => track ? { p: null, i: null } : NONE

  const cache = new Map()
  // node -> (d, sc, st, a, b) => boolean: d the value, sc the dynamic scope,
  // st the reference guard, a the annotation sink, b the base in effect.
  function get (s) {
    if (s === false) return F
    if (!isObj(s)) return T
    let f = cache.get(s)
    if (f) return f
    let impl
    f = (d, sc, st, a, b) => impl(d, sc, st, a, b)
    cache.set(s, f)
    impl = build(s)
    return f
  }

  function build (s) {
    const fixed = state.resources.get(state.nodeBase.get(s)) === s ? state.nodeBase.get(s) : undefined
    if (s.unevaluatedProperties !== undefined || s.unevaluatedItems !== undefined) track = true
    const steps = []
    const step = (fn) => steps.push(fn)
    // An in-place subschema: its annotations reach this node only when it
    // passes.
    const inPlace = (f, d, sc, st, a, b) => {
      const sub = ann()
      if (!f(d, sc, st, sub, b)) return false
      if (a !== NONE) merge(a, sub)
      return true
    }

    const tracked = typeof s.$ref === 'string' || typeof s.$dynamicRef === 'string'
    if (typeof s.$ref === 'string') {
      const ref = s.$ref; const byBase = new Map()
      step((d, sc, st, a, b) => {
        let t = byBase.get(b)
        if (t === undefined) { const r = resolveRef(ref, b, state); t = r.node === undefined ? null : { f: get(r.node), base: r.base }; byBase.set(b, t) }
        return t !== null && inPlace(t.f, d, sc, st, a, t.base)
      })
    }
    if (typeof s.$dynamicRef === 'string') {
      const ref = s.$dynamicRef; const byBase = new Map()
      step((d, sc, st, a, b) => {
        let init = byBase.get(b)
        if (init === undefined) {
          const r = resolveRef(ref, b, state); const frag = splitFragment(resolveUri(b, ref))[1]
          init = { node: r.node, base: r.base, frag, byAnchor: !!frag && frag[0] !== '/' }
          byBase.set(b, init)
        }
        let node = init.node; let rb = init.base
        if (init.byAnchor) {
          // 2020-12 consults the dynamic scope only when the initial target
          // carries the anchor itself (bookending); v1 always does.
          const m0 = state.dynamicAnchors.get(rb)
          if (!bookending || (node !== undefined && m0 !== undefined && m0.get(init.frag) === node)) {
            for (const x of sc) { const m = state.dynamicAnchors.get(x); if (m && m.has(init.frag)) { node = m.get(init.frag); rb = x; break } }
          }
        }
        return node !== undefined && inPlace(get(node), d, sc, st, a, rb)
      })
    }

    if (s.type !== undefined) {
      let mask = 0; for (const t of isArr(s.type) ? s.type : [s.type]) mask |= has(BIT, t) ? BIT[t] : 127
      step((d) => (bits(d) & mask) !== 0)
    }
    if (s.enum !== undefined && s.enum !== null) {
      const vals = s.enum; const prims = new Set(); const objs = []
      if (isArr(vals)) for (const v of vals) { if (v !== null && typeof v === 'object') objs.push(v); else if (!(typeof v === 'number' && v !== v)) prims.add(v) }
      step((d) => d === null || typeof d !== 'object' ? prims.has(d) : objs.some((o) => eq(o, d)))
    }
    if (s.const !== undefined) { const c = s.const; step((d) => eq(c, d)) }

    const num = (k, test) => { const m = s[k]; if (typeof m === 'number') step((d) => !Number.isFinite(d) || test(d, m)) }
    num('minimum', (d, m) => d >= m)
    num('maximum', (d, m) => d <= m)
    num('exclusiveMinimum', (d, m) => d > m)
    num('exclusiveMaximum', (d, m) => d < m)
    num('multipleOf', multipleOk)
    if (s.minLength !== undefined) { const m = s.minLength; step((d) => typeof d !== 'string' || cpAtLeast(d, m)) }
    if (s.maxLength !== undefined) { const m = s.maxLength; step((d) => typeof d !== 'string' || cpAtMost(d, m)) }
    if (s.pattern !== undefined) { const re = pattern(s.pattern); step((d) => typeof d !== 'string' || re.test(d)) }
    if (typeof s.format === 'string') { const fn = format(s.format); if (fn !== null) step((d) => typeof d !== 'string' || !!fn(d)) }

    if (s.minItems !== undefined) { const m = s.minItems; step((d) => !isArr(d) || d.length >= m) }
    if (s.maxItems !== undefined) { const m = s.maxItems; step((d) => !isArr(d) || d.length <= m) }
    if (s.uniqueItems === true) step((d) => !isArr(d) || allDistinct(d))
    const prefix = isArr(s.prefixItems) ? s.prefixItems.map(get) : null
    const items = s.items !== undefined ? get(s.items) : null
    if (prefix || items) {
      step((d, sc, st, a, b) => {
        if (!isArr(d)) return true
        const n = prefix ? Math.min(prefix.length, d.length) : 0
        for (let i = 0; i < n; i++) { if (!prefix[i](d[i], sc, st, NONE, b)) return false; if (a !== NONE) addI(a, i) }
        if (items) for (let i = prefix ? prefix.length : 0; i < d.length; i++) { if (!items(d[i], sc, st, NONE, b)) return false; if (a !== NONE) addI(a, i) }
        return true
      })
    }
    if (s.contains !== undefined) {
      const c = get(s.contains); const minC = s.minContains !== undefined ? s.minContains : 1; const maxC = s.maxContains
      step((d, sc, st, a, b) => {
        if (!isArr(d)) return true
        let n = 0
        for (let i = 0; i < d.length; i++) if (c(d[i], sc, st, NONE, b)) { n++; if (a !== NONE) addI(a, i) }
        return !(n < minC) && !(maxC !== undefined && n > maxC)
      })
    }

    const props = isObj(s.properties) ? new Map(Object.keys(s.properties).map((k) => [k, get(s.properties[k])])) : null
    const req = isArr(s.required) ? s.required : null
    if (req) step((d) => { if (bits(d) !== O_) return true; for (const k of req) if (!has(d, k) || d[k] === undefined) return false; return true })
    if (s.minProperties !== undefined) { const m = s.minProperties; step((d) => bits(d) !== O_ || count(d) >= m) }
    if (s.maxProperties !== undefined) { const m = s.maxProperties; step((d) => bits(d) !== O_ || count(d) <= m) }
    if (isObj(s.dependentRequired)) {
      const deps = Object.entries(s.dependentRequired)
      step((d) => { if (bits(d) !== O_) return true; for (const [k, list] of deps) if (has(d, k)) for (const x of list) if (!has(d, x)) return false; return true })
    }
    if (s.propertyNames !== undefined) {
      const pn = get(s.propertyNames)
      step((d, sc, st, a, b) => { if (bits(d) !== O_) return true; for (const k of Object.getOwnPropertyNames(d)) if (propEnum.call(d, k) && !pn(k, sc, st, NONE, b)) return false; return true })
    }
    const pats = isObj(s.patternProperties) ? Object.keys(s.patternProperties).map((src) => ({ re: pattern(src), f: get(s.patternProperties[src]) })) : null
    const ap = s.additionalProperties
    const apf = ap !== undefined && ap !== false ? get(ap) : null
    if (props || pats || ap !== undefined) {
      step((d, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        for (const key of Object.getOwnPropertyNames(d)) {
          let evaluated = false
          const prop = props !== null ? props.get(key) : undefined
          const seen = (prop !== undefined && pats === null && ap === undefined) || propEnum.call(d, key)
          if (prop !== undefined) {
            const v = d[key]
            if (v !== undefined && !prop(v, sc, st, NONE, b)) return false
            evaluated = true
          }
          if (pats !== null && seen) for (const p of pats) if (p.re.test(key)) { if (!p.f(d[key], sc, st, NONE, b)) return false; evaluated = true }
          if (!evaluated && seen && ap !== undefined) { if (ap === false || !apf(d[key], sc, st, NONE, b)) return false; evaluated = true }
          if (evaluated && a !== NONE) addP(a, key)
        }
        return true
      })
    }
    if (isObj(s.dependentSchemas)) {
      const deps = Object.entries(s.dependentSchemas).map(([k, x]) => [k, get(x)])
      step((d, sc, st, a, b) => { if (bits(d) !== O_) return true; for (const [k, f] of deps) if (has(d, k) && !inPlace(f, d, sc, st, a, b)) return false; return true })
    }
    if (isObj(s.propertyDependencies)) {
      const deps = Object.entries(s.propertyDependencies).filter(([, c]) => isObj(c)).map(([k, c]) => [k, new Map(Object.keys(c).map((v) => [v, get(c[v])]))])
      step((d, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        for (const [k, choices] of deps) {
          if (!has(d, k) || typeof d[k] !== 'string') continue
          const f = choices.get(d[k])
          if (f !== undefined && !inPlace(f, d, sc, st, a, b)) return false
        }
        return true
      })
    }

    if (isArr(s.allOf)) {
      const fs = s.allOf.map(get)
      step((d, sc, st, a, b) => { for (const f of fs) if (!inPlace(f, d, sc, st, a, b)) return false; return true })
    }
    if (isArr(s.anyOf)) {
      const fs = s.anyOf.map(get)
      // Every passing branch annotates, so all are run where annotations are read.
      step((d, sc, st, a, b) => { let ok = false; for (const f of fs) if (inPlace(f, d, sc, st, a, b)) { ok = true; if (a === NONE) break } return ok })
    }
    if (isArr(s.oneOf)) {
      const fs = s.oneOf.map(get)
      step((d, sc, st, a, b) => {
        let n = 0; let win = null
        for (const f of fs) { const sub = ann(); if (f(d, sc, st, sub, b)) { if (++n > 1) return false; win = sub } }
        if (n !== 1) return false
        if (a !== NONE) merge(a, win)
        return true
      })
    }
    if (s.not !== undefined) { const f = get(s.not); step((d, sc, st, a, b) => !f(d, sc, st, NONE, b)) }
    if (s.if !== undefined) {
      const fi = get(s.if); const th = s.then !== undefined ? get(s.then) : null; const el = s.else !== undefined ? get(s.else) : null
      step((d, sc, st, a, b) => {
        const isub = ann()
        if (fi(d, sc, st, isub, b)) { if (a !== NONE) merge(a, isub); return !th || inPlace(th, d, sc, st, a, b) }
        return !el || inPlace(el, d, sc, st, a, b)
      })
    }

    // unevaluated*, last, against what everything above evaluated here.
    const uP = s.unevaluatedProperties; const uI = s.unevaluatedItems
    if (uP !== undefined) {
      const f = uP === false ? F : get(uP)
      step((d, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        for (const key of Object.keys(d)) {
          if (a.p && a.p.has(key)) continue
          if (!f(d[key], sc, st, NONE, b)) return false
          addP(a, key)
        }
        return true
      })
    }
    if (uI !== undefined) {
      const f = uI === false ? F : get(uI)
      step((d, sc, st, a, b) => {
        if (!isArr(d)) return true
        for (let i = 0; i < d.length; i++) {
          if (a.i && a.i.has(i)) continue
          if (!f(d[i], sc, st, NONE, b)) return false
          addI(a, i)
        }
        return true
      })
    }

    const n = steps.length
    const own = uP !== undefined || uI !== undefined
    return (d, sc, st, sink, b) => {
      const base = fixed !== undefined ? fixed : b
      if (tracked) {
        for (let i = st.length - 2; i >= 0; i -= 2) if (st[i] === s && st[i + 1] === d) return true
        st.push(s, d)
      }
      let pushed = false
      if (dynamic && sc[sc.length - 1] !== base) { sc.push(base); pushed = true }
      const a = track && (sink !== NONE || own) ? { p: null, i: null } : NONE
      let ok = true
      for (let i = 0; i < n; i++) if (!steps[i](d, sc, st, a, base)) { ok = false; break }
      if (pushed) sc.pop()
      if (tracked) st.length -= 2
      if (ok && a !== NONE && sink !== NONE) merge(sink, a)
      return ok
    }
  }

  const fn = get(root)
  return (d) => fn(d, [top], [], NONE, top)
}

module.exports = { createFull }
