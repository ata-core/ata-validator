'use strict'

// The verdict core: a schema to (value) => boolean, or null for a schema it
// does not take. It answers as the interpreter's walk does
// (tests/test_core_verdict.js holds it to that on the official suite) and
// does nothing else: no errors, no annotations. For a value that fails, the
// explain engine (lib/engine-small.js) says why.
//
// How it is built:
// - A scan of the schema decides up front whether it is taken. Anything this
//   file does not implement ($dynamicRef, unevaluated*, embedded $id
//   resources, references that leave the document) makes it decline.
// - A node is compiled the first time a value reaches it. Each child sits in
//   a slot holding a stub that compiles the child and puts it in its place.
// - A value's type is read once per node; keywords are grouped by the type
//   they constrain, and a node of one type gets a closure for that type.
// - Objects are walked with for-in, which reads a property through the enum
//   cache. Leaf checks of their properties (a type, a constant) run in the
//   loop without a call. A value for-in cannot describe exactly (a property
//   that is not enumerable, an inherited enumerable key) is handed to an
//   exact path: inherited keys come after own keys in for-in order, so the
//   last key tells whether any was met.
// - Leaves without subschemas are shared by every validator in the process,
//   keyed by their constraints.
// - Only a $ref can make the walk reach the same (node, value) pair again.
//   Where that happens (cyclic data, a reference cycle that reads no data)
//   the stack overflows; the call is then run again with the interpreter's
//   cycle guard, which answers true at a repeated pair.

const { indexSchemas, resolveRef, compilePattern } = require('../engine-shared')
const { _deq: eq, allDistinct } = require('../unique-items')

const has = Object.hasOwn
const isArr = Array.isArray
const keysOf = Object.keys
const T = () => true
const F = () => false
const STR = (d) => typeof d === 'string'
const NUM = (d) => Number.isFinite(d)
const INT = (d) => Number.isInteger(d)
const BOOL = (d) => typeof d === 'boolean'
const NUL = (d) => d === null
const isMap = (v) => typeof v === 'object' && v !== null && !isArr(v)

// Type bits as the interpreter has them: an integer also carries `number`, a
// number that is not finite carries none, an unknown type name matches all.
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
const multipleOk = (d, m) => { if (m === 0) return false; const q = d / m; return Number.isInteger(q) || Math.abs(q - Math.round(q)) < 1e-9 }

// Leaf checks the object and array loops run in place, by code. 7 is a
// constant (the slot holds the value), 0 a call.
const CODE = new Map([[STR, 1], [NUM, 2], [INT, 3], [BOOL, 4], [NUL, 5], [T, 6]])
// 7 a constant, 8 an integer and 9 a number between two bounds, 10 a string
// of a length between two bounds: the slot holds the argument.
const ARG = new WeakMap()
const codeOf = (f) => CODE.get(f) || (ARG.has(f) ? ARG.get(f)[0] : 0)
const argOf = (f, c) => c < 7 ? f : ARG.get(f)[1]
const lenOk = (x, lo, hi) => { const l = x.length; return (l >= 2 * lo || (l >= lo && cpLen(x) >= lo)) && (l <= hi || (l <= 2 * hi + 1 && cpLen(x) <= hi)) }
// A leaf check by code and argument, where it is not written in place.
const leafOk = (c, a, x) => c === 7 ? x === a : c === 8 ? Number.isInteger(x) && x >= a[0] && x <= a[1] : c === 9 ? Number.isFinite(x) && x >= a[0] && x <= a[1] : c === 10 ? typeof x === 'string' && lenOk(x, a[0], a[1]) : a(x)

// Process-wide: compiled patterns and leaves, by source and by constraints.
// Bounded, so a process that builds many distinct schemas stops interning
// rather than growing.
const LIMIT = 8192
const patterns = new Map()
const leaves = new Map()
const intern = (m, k, make) => { let v = m.get(k); if (v === undefined) { v = make(); if (m.size < LIMIT) m.set(k, v) } return v }
const pattern = (src) => intern(patterns, src, () => compilePattern(src))
let table = null

const BOUND = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains']
const DECLINE = ['$dynamicRef', '$recursiveRef', '$dynamicAnchor', '$recursiveAnchor', 'unevaluatedProperties', 'unevaluatedItems', 'propertyDependencies']
const ONE = ['items', 'additionalProperties', 'propertyNames', 'contains', 'not', 'if', 'then', 'else']
const LIST = ['prefixItems', 'allOf', 'anyOf', 'oneOf']
const MAPS = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions']
const allStr = (v) => isArr(v) && v.every(STR)
// Every name the interpreter reads as a keyword; any other is an annotation.
const KW = new Set(['$ref', '$id', '$anchor', 'type', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern', 'format', 'uniqueItems', 'required', 'dependentRequired', 'then', 'else'].concat(BOUND, DECLINE, ONE, LIST, MAPS))

function createVerdict (root, options) {
  const opts = options || {}
  if (opts.keywords || opts.coerce || opts.discriminator || (opts.numberFormats && keysOf(opts.numberFormats).length > 0)) return null
  if (typeof root === 'boolean') return root ? T : F
  if (!isMap(root)) return null
  const fmts = opts.formats || null

  // The scan: every place the resource index walks, plus the targets of
  // references. Declines on anything not implemented here.
  let refs = null; let anchors = false; let bad = false
  const visit = (s, depth) => {
    if (bad || typeof s !== 'object' || s === null) return
    if (depth > 500) { bad = true; return }
    if (typeof s.$ref === 'string') (refs || (refs = [])).push(s)
    if (typeof s.$id === 'string' && s !== root) bad = true
    if (typeof s.$anchor === 'string') anchors = true
    for (const k of DECLINE) if (s[k] !== undefined) bad = true
    const t = s.type
    if (t !== undefined && typeof t !== 'string' && !allStr(t)) bad = true
    if (s.enum !== undefined && !isArr(s.enum)) bad = true
    for (const k of BOUND) if (s[k] !== undefined && typeof s[k] !== 'number') bad = true
    if (s.pattern !== undefined) { if (typeof s.pattern === 'string') pattern(s.pattern); else bad = true }
    if (isArr(s.required) && !allStr(s.required)) bad = true
    if (isMap(s.dependentRequired)) for (const k in s.dependentRequired) if (!allStr(s.dependentRequired[k])) bad = true
    if (isMap(s.patternProperties)) for (const k in s.patternProperties) pattern(k)
    for (const k of ONE) if (s[k] !== undefined) visit(s[k], depth + 1)
    for (const k of LIST) if (isArr(s[k])) for (const x of s[k]) visit(x, depth + 1)
    for (const k of MAPS) if (isMap(s[k])) for (const x in s[k]) visit(s[k][x], depth + 1)
  }
  visit(root, 0)
  if (bad) return null
  let targets = null
  if (refs !== null) {
    const state = indexSchemas(root, opts.schemaMap, !anchors)
    targets = new Map()
    const seen = new Set()
    for (let i = 0; i < refs.length; i++) {
      const r = resolveRef(refs[i].$ref, state.rootBase, state)
      if (r.node === undefined || r.base !== state.rootBase || (typeof r.node !== 'boolean' && !isMap(r.node))) return null
      targets.set(refs[i], r.node)
      if (!seen.has(r.node)) { seen.add(r.node); visit(r.node, 0); if (bad) return null }
    }
  }

  // The interpreter's cycle guard, used only on the second run of a call
  // whose first overflowed the stack.
  const stack = []
  const tracked = (s, f, d) => {
    for (let i = stack.length - 2; i >= 0; i -= 2) if (stack[i] === s && stack[i + 1] === d) return true
    stack.push(s, d)
    const ok = f(d)
    stack.length -= 2
    return ok
  }

  // The checks, built lazily. `track` builds the tree the second run uses:
  // every node with a $ref keeps the cycle guard. Without it, a node that
  // holds only a $ref is its target's check.
  function tree (track) {
    const byTarget = targets && new Map()
    const ref = (t) => {
      let f = byTarget.get(t)
      if (f === undefined) { byTarget.set(t, null); byTarget.set(t, (f = get(t))) } else if (f === null) f = (d) => byTarget.get(t)(d)
      return f
    }

    // A slot: a stub that compiles `s` on its first call and puts the result
    // where the stub was.
    const slots = (list) => { const fs = list.map((s, i) => (d) => (fs[i] = get(s))(d)); return fs }

    function get (s) {
      if (s === false) return F
      if (typeof s !== 'object' || s === null || isArr(s)) return T
      return build(s)
    }

    function format (name) {
      if (typeof name !== 'string') return null
      if (fmts !== null && has(fmts, name) && typeof fmts[name] === 'function') return fmts[name]
      const tb = table || (table = require('../formats').formatChecks())
      return has(tb, name) && typeof tb[name] === 'function' ? tb[name] : null
    }

    function build (s) {
      // Keyword values, read once.
      let type, en, cn = false, cv
      let mn, mx, xmn, xmx, mo, lo, hi, pat, fm
      let mi, ma, uq = false, pre, items, ct, mic, mac
      let props, req, mip, map, dr, pn, pp, ap, ds
      let rf, all, any, one, not, iff, then, els
      let sub = false
      for (const k in s) {
        const v = s[k]
        switch (k) {
          case 'type': type = v; break
          case 'enum': en = v; break
          case 'const': if (v !== undefined) { cn = true; cv = v } break
          case 'minimum': if (typeof v === 'number') mn = v; break
          case 'maximum': if (typeof v === 'number') mx = v; break
          case 'exclusiveMinimum': if (typeof v === 'number') xmn = v; break
          case 'exclusiveMaximum': if (typeof v === 'number') xmx = v; break
          case 'multipleOf': if (typeof v === 'number') mo = v; break
          case 'minLength': lo = v; break
          case 'maxLength': hi = v; break
          case 'pattern': pat = v; break
          case 'format': fm = format(v); break
          case 'minItems': mi = v; break
          case 'maxItems': ma = v; break
          case 'uniqueItems': uq = v === true; break
          case 'prefixItems': if (isArr(v)) { pre = v; sub = true } break
          case 'items': if (v !== undefined) { items = v; sub = true } break
          case 'contains': if (v !== undefined) { ct = v; sub = true } break
          case 'minContains': mic = v; break
          case 'maxContains': mac = v; break
          case 'properties': if (isMap(v)) { props = v; sub = true } break
          case 'required': if (isArr(v)) req = v; break
          case 'minProperties': mip = v; break
          case 'maxProperties': map = v; break
          case 'dependentRequired': if (isMap(v)) dr = v; break
          case 'propertyNames': if (v !== undefined) { pn = v; sub = true } break
          case 'patternProperties': if (isMap(v)) { pp = v; sub = true } break
          case 'additionalProperties': if (v !== undefined) { ap = v; sub = true } break
          case 'dependentSchemas': if (isMap(v)) { ds = v; sub = true } break
          case '$ref': if (typeof v === 'string') { rf = targets.get(s); sub = true } break
          case 'allOf': if (isArr(v)) { all = v; sub = true } break
          case 'anyOf': if (isArr(v)) { any = v; sub = true } break
          case 'oneOf': if (isArr(v)) { one = v; sub = true } break
          case 'not': if (v !== undefined) { not = v; sub = true } break
          case 'if': if (v !== undefined) { iff = v; sub = true } break
          case 'then': if (v !== undefined) then = v; break
          case 'else': if (v !== undefined) els = v; break
        }
      }
      let mask = -1
      if (type !== undefined) {
        mask = 0
        if (typeof type === 'string') mask = BIT[type] || 127
        else for (const t of type) mask |= BIT[t] || 127
      }
      const typed = type !== undefined
      const hasNum = mn !== undefined || mx !== undefined || xmn !== undefined || xmx !== undefined || mo !== undefined
      const hasStr = lo !== undefined || hi !== undefined || pat !== undefined || fm != null
      const hasArr = mi !== undefined || ma !== undefined || uq || pre !== undefined || items !== undefined || ct !== undefined
      const hasObj = props !== undefined || req !== undefined || mip !== undefined || map !== undefined || dr !== undefined || pn !== undefined || pp !== undefined || ap !== undefined || ds !== undefined

      // A leaf without subschemas: shared process-wide when its format, if
      // any, is a built-in one.
      if (!sub && !hasArr && !hasObj) {
        if (!hasNum && !hasStr && en === undefined && !cn) return mask === -1 ? T : mask === S_ ? STR : mask === N_ ? NUM : mask === I_ ? INT : mask === B_ ? BOOL : mask === Z_ ? NUL : intern(leaves, 't' + mask, () => typeOnly(mask))
        const vk = fm != null && fmts !== null && has(fmts, s.format) ? null : valueKey(en, cn, cv)
        const make = () => leaf(typed, mask, en, cn, cv, hasNum, mn, mx, xmn, xmx, mo, hasStr, lo, hi, pat, fm)
        if (vk === null) return make()
        return intern(leaves, JSON.stringify([mask, mn, mx, xmn, xmx, mo, lo, hi, fm != null ? s.format : 0, pat === undefined ? 0 : pat].map((v) => typeof v === 'number' ? String(v) : v === undefined ? 0 : v)) + vk, make)
      }

      const vf = en !== undefined || cn ? valueCheck(en, cn, cv) : null
      const sf = hasStr ? strCheck(false, lo, hi, pat, fm) : null
      const nf = hasNum ? numCheck(false, false, mn, mx, xmn, xmx, mo) : null
      const af = hasArr ? arrCheck(mask === A_, mi, ma, uq, pre, items, ct, mic, mac) : null
      const of = hasObj ? objCheck(mask === O_, props, req, mip, map, dr, pn, pp, ap, ds) : null

      const ip = []
      if (rf !== undefined) {
        if (!track && !typed && vf === null && sf === null && nf === null && af === null && of === null && all === undefined && any === undefined && one === undefined && not === undefined && iff === undefined) return ref(rf)
        let g = (d) => (g = ref(rf))(d)
        ip.push((d) => g(d))
      }
      if (all !== undefined) { const fs = slots(all); ip.push((d) => { for (let i = 0; i < fs.length; i++) if (!fs[i](d)) return false; return true }) }
      if (any !== undefined) ip.push(union(any, true))
      if (one !== undefined) ip.push(union(one, false))
      if (not !== undefined) { let g = (d) => (g = get(not))(d); ip.push((d) => !g(d)) }
      if (iff !== undefined && (then !== undefined || els !== undefined)) {
        let fi = (d) => (fi = get(iff))(d)
        let ft = then === undefined ? T : (d) => (ft = get(then))(d)
        let fe = els === undefined ? T : (d) => (fe = get(els))(d)
        ip.push((d) => fi(d) ? ft(d) : fe(d))
      }

      let f
      const groups = (sf !== null) + (nf !== null) + (af !== null) + (of !== null)
      if (vf === null && ip.length === 0 && groups === 1 && ((af !== null && mask === A_) || (of !== null && mask === O_))) f = af || of
      else if (vf === null && !typed && groups === 0 && ip.length === 1) f = ip[0]
      else if (vf === null && !typed && groups === 1 && ip.length === 0 && (af !== null || of !== null)) f = af || of
      else {
        const n = ip.length
        f = (d) => {
          const t = bits(d)
          if (typed && (t & mask) === 0) return false
          if (vf !== null && !vf(d)) return false
          if (t === S_) { if (sf !== null && !sf(d)) return false } else if (t === O_) { if (of !== null && !of(d)) return false } else if (t === A_) { if (af !== null && !af(d)) return false } else if ((t & N_) !== 0 && nf !== null && !nf(d)) return false
          for (let i = 0; i < n; i++) if (!ip[i](d)) return false
          return true
        }
      }
      return rf === undefined || !track ? f : (d) => tracked(s, f, d)
    }

    // anyOf / oneOf. Where every branch is an object that requires the same
    // property to hold a different string constant, the value of that
    // property picks the only branch that can pass.
    function union (list, anyOf) {
      const fs = slots(list)
      const n = fs.length
      const tag = tagOf(list)
      if (tag !== null) {
        const [name, values] = tag
        return (d) => {
          if (typeof d !== 'object' || d === null || isArr(d)) return false
          const v = d[name]
          for (let i = 0; i < n; i++) if (values[i] === v) return fs[i](d)
          return false
        }
      }
      // Branches that name types and nothing else: one test of the union.
      if (anyOf && list.every((b) => isMap(b) && b.type !== undefined && keysOf(b).every((k) => k === 'type' || !KW.has(k)))) {
        let m = 0
        for (const b of list) for (const t of isArr(b.type) ? b.type : [b.type]) m |= BIT[t] || 127
        return intern(leaves, 't' + m, () => typeOnly(m))
      }
      if (anyOf) return n === 2 ? (d) => fs[0](d) || fs[1](d) : (d) => { for (let i = 0; i < n; i++) if (fs[i](d)) return true; return false }
      return (d) => { let c = 0; for (let i = 0; i < n; i++) if (fs[i](d) && ++c > 1) return false; return c === 1 }
    }

    // [check of a value of the right type]: `g` is the answer for a value of
    // another type.
    function objCheck (g, props, req, mip, map, dr, pn, pp, ap, ds) {
      const names = props === undefined ? [] : keysOf(props)
      const n = names.length
      const codes = names.map(() => 0)
      const fs = names.map((k, i) => (x) => { const f = get(props[k]); const c = codeOf(f); codes[i] = c; fs[i] = argOf(f, c); return f(x) })
      let rq = 0; const rqi = []; let xr = null
      if (req !== undefined) for (const k of req) { const i = names.indexOf(k); if (i < 0) { if (!(xr || (xr = [])).includes(k)) xr.push(k) } else if (n > 31) rqi[i] = true; else rq |= 1 << i }
      const isReq = n > 31 ? (i) => rqi[i] === true : (i) => ((rq >>> i) & 1) === 1
      const closed = ap === false
      const pats = pp === undefined ? null : keysOf(pp).map((k) => pattern(k))
      const pfs = pp === undefined ? null : slots(keysOf(pp).map((k) => pp[k]))
      let apf = ap === undefined || ap === true || closed ? null : (d) => (apf = get(ap))(d)
      let pnf = pn === undefined ? null : (d) => (pnf = get(pn))(d)
      const deps = dr === undefined ? null : keysOf(dr)
      const dss = ds === undefined ? null : keysOf(ds)
      const dsf = ds === undefined ? null : slots(dss.map((k) => ds[k]))
      const lo = mip === undefined ? 0 : mip
      const hi = map === undefined ? Infinity : map
      const value = (i, x) => leafOk(codes[i], fs[i], x)

      // After the keys: declared names the walk did not meet (absent, or own
      // and not enumerable), required names that are not declared, and the
      // rest of the object keywords.
      const finish = (o, hits, seen, count) => {
        if (count < lo || count > hi) return false
        if (hits !== n) {
          for (let i = 0; i < n; i++) {
            const k = names[i]
            if (n > 31 ? has(o, k) && Object.prototype.propertyIsEnumerable.call(o, k) : ((seen >>> i) & 1) === 1) continue
            const x = has(o, k) ? o[k] : undefined
            if (x === undefined) { if (isReq(i)) return false } else if (!value(i, x)) return false
          }
        }
        if (xr !== null) for (let i = 0; i < xr.length; i++) if (!has(o, xr[i]) || o[xr[i]] === undefined) return false
        if (deps !== null) for (const k of deps) if (has(o, k)) for (const x of dr[k]) if (!has(o, x)) return false
        if (dss !== null) for (let i = 0; i < dss.length; i++) if (has(o, dss[i]) && !dsf[i](o)) return false
        return true
      }

      // One key: -1 when it fails, else 1 + its declared index, or 0.
      const key = (o, k) => {
        let i = 0
        while (i < n && names[i] !== k) i++
        let r = 0; let ev = i < n
        if (ev) { r = i + 1; const x = o[k]; if (x === undefined ? isReq(i) : !value(i, x)) return -1 }
        if (pats !== null) for (let j = 0; j < pats.length; j++) if (pats[j].test(k)) { ev = true; if (!pfs[j](o[k])) return -1 }
        if (!ev) { if (closed) return -1; if (apf !== null && !apf(o[k])) return -1 }
        if (pnf !== null && !pnf(k)) return -1
        return r
      }

      // The exact path: own enumerable keys from Object.keys.
      const exact = (o) => {
        let hits = 0, seen = 0
        const ks = keysOf(o)
        for (let j = 0; j < ks.length; j++) { const r = key(o, ks[j]); if (r < 0) return false; if (r > 0) { hits++; seen |= 1 << (r - 1) } }
        return finish(o, hits, seen, ks.length)
      }

      const plain = xr === null && deps === null && dss === null && lo === 0 && hi === Infinity
      if (pats === null && apf === null && pnf === null && n <= 31 && lo === 0 && hi === Infinity) {
        // Declared properties, open or closed.
        return (o) => {
          if (typeof o !== 'object' || o === null || isArr(o)) return !g
          let hits = 0, seen = 0, next = 0, count = 0, last
          for (const k in o) {
            last = k
            count++
            let i = next
            if (names[i] !== k) {
              i = 0
              while (i < n && names[i] !== k) i++
              if (i === n) { if (closed) return has(o, k) ? false : exact(o); continue }
            }
            next = i + 1
            hits++
            seen |= 1 << i
            const x = o[k]
            if (x === undefined) { if (((rq >>> i) & 1) === 1) return has(o, k) ? false : exact(o); continue }
            switch (codes[i]) {
              case 1: if (typeof x === 'string') continue; break
              case 2: if (Number.isFinite(x)) continue; break
              case 3: if (Number.isInteger(x)) continue; break
              case 4: if (typeof x === 'boolean') continue; break
              case 5: if (x === null) continue; break
              case 6: continue
              case 7: if (x === fs[i]) continue; break
              case 8: { const a = fs[i]; if (Number.isInteger(x) && x >= a[0] && x <= a[1]) continue; break }
              case 9: { const a = fs[i]; if (Number.isFinite(x) && x >= a[0] && x <= a[1]) continue; break }
              case 10: { const a = fs[i]; if (typeof x === 'string' && lenOk(x, a[0], a[1])) continue; break }
              default: if (fs[i](x)) continue
            }
            return has(o, k) ? false : exact(o)
          }
          if (hits !== n) {
            for (let i = 0; i < n; i++) {
              if (((seen >>> i) & 1) === 1) continue
              const k = names[i]
              const x = has(o, k) ? o[k] : undefined
              if (x === undefined) { if (((rq >>> i) & 1) === 1) return false } else if (!leafOk(codes[i], fs[i], x)) return false
            }
          }
          if (rq !== 0 && last !== undefined && !has(o, last)) return exact(o)
          return plain || finish(o, n, seen, count)
        }
      }
      return (o) => {
        if (typeof o !== 'object' || o === null || isArr(o)) return !g
        let hits = 0, seen = 0, count = 0, last
        for (const k in o) {
          last = k
          count++
          const r = key(o, k)
          if (r < 0) return has(o, k) ? false : exact(o)
          if (r > 0) { hits++; seen |= 1 << (r - 1) }
        }
        if (last !== undefined && !has(o, last)) return exact(o)
        return finish(o, hits, seen, count)
      }
    }

    function arrCheck (g, mi, ma, uq, pre, items, ct, mic, mac) {
      const lo = mi === undefined ? 0 : mi
      const hi = ma === undefined ? Infinity : ma
      const ps = pre === undefined ? null : slots(pre)
      const start = ps === null ? 0 : ps.length
      let code = 0
      let it = items === undefined ? null : (x) => { const f = get(items); code = codeOf(f); it = argOf(f, code); return f(x) }
      let cf = ct === undefined ? null : (x) => (cf = get(ct))(x)
      const cmin = mic === undefined ? 1 : mic
      if (ps === null && cf === null && !uq) {
        return (d) => {
          if (!isArr(d)) return !g
          const len = d.length
          if (len < lo || len > hi) return false
          if (it === null) return true
          switch (code) {
            case 1: for (let i = 0; i < len; i++) if (typeof d[i] !== 'string') return false; return true
            case 6: return true
            case 7: for (let i = 0; i < len; i++) if (d[i] !== it) return false; return true
          }
          // The first item may compile the item schema and change the code.
        for (let i = 0; i < len; i++) if (code === 0 ? !it(d[i]) : !leafOk(code, it, d[i])) return false
          return true
        }
      }
      return (d) => {
        if (!isArr(d)) return !g
        const len = d.length
        if (len < lo || len > hi) return false
        if (uq && !allDistinct(d)) return false
        let i = 0
        if (ps !== null) for (; i < start && i < len; i++) if (!ps[i](d[i])) return false
        if (it !== null) for (i = start; i < len; i++) if (!leafOk(code, it, d[i])) return false
        if (cf !== null) {
          let c = 0
          for (i = 0; i < len; i++) if (cf(d[i]) && ++c >= cmin && mac === undefined) break
          if (c < cmin || (mac !== undefined && c > mac)) return false
        }
        return true
      }
    }

    return build(root)
  }

  const fn = tree(false)
  if (refs === null) return fn
  let guarded = null
  return (d) => {
    try { return fn(d) } catch (e) {
      if (!(e instanceof RangeError)) throw e
      stack.length = 0
      return (guarded || (guarded = tree(true)))(d)
    }
  }
}


// The common subschema of an anyOf or oneOf: [name, constants by branch],
// or null.
function tagOf (list) {
  if (list.length < 2) return null
  const b0 = list[0]
  if (!isMap(b0) || !isMap(b0.properties) || !isArr(b0.required)) return null
  for (const name of b0.required) {
    const values = []
    for (const b of list) {
      if (!isMap(b) || b.type !== 'object' || !isArr(b.required) || !b.required.includes(name) || !isMap(b.properties)) return null
      const p = b.properties[name]
      const c = isMap(p) && has(b.properties, name) ? p.const : undefined
      if (typeof c !== 'string' || values.includes(c)) { values.length = 0; break }
      values.push(c)
    }
    if (values.length === list.length) return [name, values]
  }
  return null
}

// A key for the value constraints of a leaf, or null when they are not
// shared (an object or array value, a number JSON cannot write).
function valueKey (en, cn, cv) {
  const ok = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v)
  if (en !== undefined && !en.every(ok)) return null
  if (cn && !ok(cv)) return null
  return JSON.stringify([en === undefined ? 0 : en, cn ? [cv] : 0])
}

function valueCheck (en, cn, cv) {
  if (cn && en === undefined) {
    if (cv !== null && typeof cv === 'object') return (d) => eq(cv, d)
    const f = (d) => d === cv
    if (cv === cv) ARG.set(f, [7, cv])
    return f
  }
  const prims = []; const objs = []
  for (const v of en) { if (v !== null && typeof v === 'object') objs.push(v); else if (v === v) prims.push(v) }
  const ef = objs.length === 0
    ? (prims.length > 8 ? ((set) => (d) => set.has(d))(new Set(prims)) : (d) => { for (let i = 0; i < prims.length; i++) if (prims[i] === d) return true; return false })
    : (d) => { if (d === null || typeof d !== 'object') { for (let i = 0; i < prims.length; i++) if (prims[i] === d) return true; return false } for (let i = 0; i < objs.length; i++) if (eq(objs[i], d)) return true; return false }
  if (!cn) return ef
  return (d) => ef(d) && eq(cv, d)
}

function strCheck (g, lo, hi, pat, fm) {
  const min = lo === undefined ? 0 : lo
  const max = hi === undefined ? Infinity : hi
  const re = pat === undefined ? null : pattern(pat)
  const f = fm == null ? null : fm
  const c = (d) => {
    if (typeof d !== 'string') return !g
    if (!lenOk(d, min, max)) return false
    return (re === null || re.test(d)) && (f === null || !!f(d))
  }
  if (g && re === null && f === null) ARG.set(c, [10, [min, max]])
  return c
}

function numCheck (g, int, mn, mx, xmn, xmx, mo) {
  const a = mn === undefined ? -Infinity : mn
  const b = mx === undefined ? Infinity : mx
  const c = xmn === undefined ? -Infinity : xmn
  const e = xmx === undefined ? Infinity : xmx
  const f = (d) => {
    if (int ? !Number.isInteger(d) : !Number.isFinite(d)) return !g
    return d >= a && d <= b && (xmn === undefined || d > c) && (xmx === undefined || d < e) && (mo === undefined || multipleOk(d, mo))
  }
  if (g && xmn === undefined && xmx === undefined && mo === undefined) ARG.set(f, [int ? 8 : 9, [a, b]])
  return f
}

const typeOnly = (mask) => (d) => (bits(d) & mask) !== 0

function leaf (typed, mask, en, cn, cv, hasNum, mn, mx, xmn, xmx, mo, hasStr, lo, hi, pat, fm) {
  const vf = en !== undefined || cn ? valueCheck(en, cn, cv) : null
  // Values that all have one of the named types: the type is implied.
  if (vf !== null && !hasNum && !hasStr && (!typed || (cn ? [cv] : en).every((v) => (bits(v) & mask) !== 0))) return vf
  if (typed && vf === null && mask === S_) return strCheck(true, lo, hi, pat, fm)
  if (typed && vf === null && !hasStr && (mask === N_ || mask === I_)) return numCheck(true, mask === I_, mn, mx, xmn, xmx, mo)
  const sf = hasStr ? strCheck(true, lo, hi, pat, fm) : null
  const nf = hasNum ? numCheck(true, false, mn, mx, xmn, xmx, mo) : null
  return (d) => {
    const t = bits(d)
    if (typed && (t & mask) === 0) return false
    if (vf !== null && !vf(d)) return false
    if (t === S_) return sf === null || sf(d)
    return (t & N_) === 0 || nf === null || nf(d)
  }
}

module.exports = { createVerdict }
