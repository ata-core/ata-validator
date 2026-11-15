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
// - A node is compiled the first time a value reaches it. A child is held as
//   its schema until then.
// - A value's type is read once per node; keywords are grouped by the type
//   they constrain, and a node of one type gets a closure for that type.
// - Objects are walked with for-in, which reads a property through the enum
//   cache. Leaf checks of their properties (a type, a constant, bounds) run
//   in the loop without a call. A value for-in does not describe exactly is
//   handed to an exact path: a declared name the walk did not meet is asked
//   for by name (it can be an own property that is not enumerable), and since
//   for-in yields inherited keys after own ones, the last key tells whether
//   any key met was inherited.
// - Leaves without subschemas are shared by every validator in the process,
//   keyed by their constraints.
// - Only a $ref can make the walk reach the same (node, value) pair again.
//   Where that happens (cyclic data, a reference cycle that reads no data)
//   the stack overflows; the call is then run again on a tree built with the
//   interpreter's cycle guard, which answers true at a repeated pair.

const { indexSchemas, resolveRef, compilePattern } = require('../engine-shared')
const { _deq: eq, allDistinct } = require('../unique-items')
const { nativeIsLinear } = require('../regex-linear')

const has = Object.hasOwn
const isArr = Array.isArray
const keysOf = Object.keys
// The names of a schema map, as Object.keys gives them. Through
// Object.entries, which does not give the map's shape an enum cache: a
// properties map usually has a shape of its own, and those caches were a
// sixth of what a compiled schema retained.
const names = (m) => { const r = []; for (const p of Object.entries(m)) r.push(p[0]); return r }
const T = () => true
const F = () => false
const STR = (d) => typeof d === 'string'
const NUM = (d) => Number.isFinite(d)
const INT = (d) => Number.isInteger(d)
const BOOL = (d) => typeof d === 'boolean'
const NUL = (d) => d === null
const propEnum = Object.prototype.propertyIsEnumerable
const isMap = (v) => typeof v === 'object' && v !== null && !isArr(v)
const isObj = (d) => typeof d === 'object' && d !== null && !isArr(d)
const allStr = (v) => isArr(v) && v.every(STR)

// Type bits as the interpreter has them: an integer also carries `number`, a
// number that is not finite carries none, an unknown type name matches all.
const S_ = 1, N_ = 2, I_ = 4, B_ = 8, Z_ = 16, O_ = 32, A_ = 64
const BIT = { string: S_, number: N_, integer: I_, boolean: B_, null: Z_, object: O_, array: A_ }
const maskOf = (t) => { let m = 0; for (const x of isArr(t) ? t : [t]) m |= has(BIT, x) ? BIT[x] : 127; return m }
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
const lenOk = (x, lo, hi) => { const l = x.length; return (l >= 2 * lo || (l >= lo && cpLen(x) >= lo)) && (l <= hi || (l <= 2 * hi + 1 && cpLen(x) <= hi)) }
const multipleOk = (d, m) => { if (m === 0) return false; const q = d / m; return Number.isInteger(q) || Math.abs(q - Math.round(q)) < 1e-9 }

// Leaf checks that object and array loops run in place, by code and
// argument: 1 to 6 a type or anything (the argument is the check), 7 a
// constant, 8 an integer and 9 a number between two bounds, 10 a string of a
// length between two bounds, 11 one of a list of strings. 0 is a call to the
// argument, -1 not compiled yet.
const LAZY = 15, REQ = 16
const CODE = new Map([[STR, 1], [NUM, 2], [INT, 3], [BOOL, 4], [NUL, 5], [T, 6]])
const leafOk = (c, a, x) => c === 7 ? x === a : c === 8 ? Number.isInteger(x) && x >= a[0] && x <= a[1] : c === 9 ? Number.isFinite(x) && x >= a[0] && x <= a[1] : c === 10 ? typeof x === 'string' && lenOk(x, a[0], a[1]) : c === 11 ? typeof x === 'string' && a.includes(x) : a(x)

// Process-wide: compiled patterns and leaves, by source and by constraints.
// Bounded, so a process that builds many distinct schemas stops interning
// rather than growing.
const LIMIT = 8192
const patterns = new Map()
const leaves = new Map()
const intern = (m, k, make) => { let v = m.get(k); if (v === undefined) { v = make(); if (m.size < LIMIT) m.set(k, v) } return v }
// A pattern the linearity proof generated code uses (lib/regex-linear.js)
// accepts runs on the platform RegExp, with the u flag where it compiles;
// any other goes to compilePattern, as the interpreter's do.
const pattern = (src) => intern(patterns, src, () => {
  const q = sequence(src)
  if (q !== null) return q
  if (!nativeIsLinear(src)) return compilePattern(src)
  try { return new RegExp(src, 'u') } catch { return new RegExp(src) }
})
let table = null

// A pattern that is `^`, a sequence of pieces that each match one printable
// ASCII character (a class without negation, \d, \w, a literal) with fixed
// repeats, and `$`; or `^`, one such piece with any repeat, and `$`. It is
// matched by a loop over char codes and a bit set per piece, with no RegExp.
// A piece matches no surrogate and no character above 126, so a string the
// loop accepts is all ASCII, and its length in code units is its length in
// code points: the answer is the platform RegExp's with or without the u
// flag. Anything else returns null and goes to a RegExp.
const SYNTAX = '\\^$.|?*+()[]{}/'
function sequence (src) {
  const end = src.length - 1
  if (end < 2 || end > 256 || src[0] !== '^' || src[end] !== '$') return null
  const sets = [], mins = [], maxs = []
  let i = 1
  const one = (set) => {
    const c = src[i]
    if (c === '\\') {
      const e = src[i + 1]
      i += 2
      if (e === 'd' || e === 'w') { for (let k = 48; k < 58; k++) set[k >> 5] |= 1 << (k & 31); if (e === 'w') { set[2] |= 0x87fffffe; set[3] |= 0x7fffffe } return -1 }
      if (e !== undefined && (SYNTAX + '-').includes(e)) return e.charCodeAt(0)
      return -2
    }
    i++
    const a = c.charCodeAt(0)
    return a < 32 || a > 126 ? -2 : a
  }
  while (i < end) {
    const set = [0, 0, 0, 0]
    if (src[i] === '[') {
      i++
      if (src[i] === '^' || src[i] === ']') return null
      while (src[i] !== ']') {
        if (i >= end) return null
        const a = one(set)
        if (a === -2) return null
        if (a === -1) { if (src[i] === '-' && src[i + 1] !== ']') return null; continue }
        let b = a
        if (src[i] === '-' && src[i + 1] !== ']') { i++; b = one(set); if (b < a) return null }
        for (let k = a; k <= b; k++) set[k >> 5] |= 1 << (k & 31)
      }
      i++
    } else {
      if (src[i] !== '\\' && SYNTAX.includes(src[i]) && src[i] !== '/') return null
      const a = one(set)
      if (a === -2 || (a >= 0 && src[i - 2] === '\\' && a === 45)) return null
      if (a >= 0) set[a >> 5] |= 1 << (a & 31)
    }
    let min = 1, max = 1
    const q = /^(?:\{(\d{1,3})(?:(,)(\d{0,3}))?\}|([?*+]))/.exec(src.slice(i, end))
    if (q !== null) {
      if (q[4] !== undefined) { min = q[4] === '+' ? 1 : 0; max = q[4] === '?' ? 1 : Infinity } else { min = +q[1]; max = q[2] === undefined ? min : q[3] === '' ? Infinity : +q[3] }
      if (max < min) return null
      i += q[0].length
    }
    sets.push(set); mins.push(min); maxs.push(max)
  }
  const bits = new Int32Array(sets.length * 4)
  sets.forEach((set, p) => bits.set(set, p * 4))
  if (sets.length === 1) {
    const lo = mins[0], hi = maxs[0]
    return { test: (x) => { const n = x.length; if (n < lo || n > hi) return false; for (let k = 0; k < n; k++) { const c = x.charCodeAt(k); if (c > 127 || ((bits[c >> 5] >>> (c & 31)) & 1) === 0) return false } return true } }
  }
  const at = []
  for (let p = 0; p < sets.length; p++) { if (mins[p] !== maxs[p]) return null; for (let k = 0; k < mins[p]; k++) at.push(p) }
  if (at.length > 256) return null
  const L = at.length, pos = Uint8Array.from(at)
  return { test: (x) => { if (x.length !== L) return false; for (let k = 0; k < L; k++) { const c = x.charCodeAt(k); if (c > 127 || ((bits[(pos[k] << 2) + (c >> 5)] >>> (c & 31)) & 1) === 0) return false } return true } }
}

// ---------- scan ----------

// Every place the resource index walks, and the targets of references.
// False when the schema holds anything this file does not implement.
function visit (s, depth, st) {
  if (typeof s !== 'object' || s === null) return true
  if (depth > 500) return false
  for (const k in s) {
    const v = s[k]
    if (v === undefined) continue
    switch (k) {
      case '$ref': if (typeof v === 'string') st.refs.push(s); break
      case '$id': if (typeof v === 'string' && s !== st.root) st.ids = true; break
      case '$anchor': if (typeof v === 'string') st.anchors = true; break
      case '$dynamicRef': case '$recursiveRef': case '$dynamicAnchor': case '$recursiveAnchor': return false
      case 'unevaluatedProperties': case 'unevaluatedItems': if (!visit(v, depth + 1, st)) return false; break
      case 'propertyDependencies':
        if (isMap(v)) for (const p of Object.entries(v)) if (isMap(p[1])) for (const q of Object.entries(p[1])) if (!visit(q[1], depth + 1, st)) return false
        break
      case 'type': if (typeof v !== 'string' && !allStr(v)) return false; break
      case 'enum': if (!isArr(v)) { st.walkThrows = true; return false } break
      case 'minLength': case 'maxLength': case 'minItems': case 'maxItems':
      case 'minProperties': case 'maxProperties': case 'minContains': case 'maxContains': if (typeof v !== 'number') return false; break
      case 'pattern': if (typeof v !== 'string') return false; pattern(v); break
      case 'required': if (isArr(v) && !allStr(v)) return false; break
      case 'dependentRequired': if (isMap(v)) for (const p of Object.entries(v)) if (!allStr(p[1])) return false; break
      case 'patternProperties': if (isMap(v)) for (const p of Object.entries(v)) { pattern(p[0]); if (!visit(p[1], depth + 1, st)) return false } break
      case 'properties': case 'dependentSchemas': case '$defs': case 'definitions':
        if (isMap(v)) for (const p of Object.entries(v)) if (!visit(p[1], depth + 1, st)) return false
        break
      case 'items': case 'additionalProperties': case 'propertyNames': case 'contains': case 'not': case 'if': case 'then': case 'else':
        if (!visit(v, depth + 1, st)) return false
        break
      case 'prefixItems': case 'allOf': case 'anyOf': case 'oneOf':
        if (isArr(v)) for (const x of v) if (!visit(x, depth + 1, st)) return false
    }
  }
  return true
}

// ---------- compile ----------

// A validator's compile state: how references resolve, the caller's formats,
// and whether the tree keeps the cycle guard.
function Ctx (targets, fmts, track) {
  this.targets = targets
  this.fmts = fmts
  this.track = track
  this.byTarget = targets === null ? null : new Map()
  this.stack = track ? [] : null
}

const PLAIN = new Ctx(null, null, false)
const get = (V, s) => s === false ? F : typeof s !== 'object' || s === null || isArr(s) ? T : build(V, s)

// A reference target's check, once per target. A chain of nodes that hold
// only a $ref and lead back to themselves gets an indirection; calling it
// overflows the stack, and the guarded tree answers.
function ref (V, t) {
  const m = V.byTarget
  let f = m.get(t)
  if (f === undefined) { m.set(t, null); m.set(t, (f = get(V, t))) } else if (f === null) f = (d) => m.get(t)(d)
  return f
}

function format (V, name) {
  if (typeof name !== 'string') return null
  const u = V.fmts
  if (u !== null && has(u, name) && typeof u[name] === 'function') return u[name]
  const tb = table || (table = require('../formats').formatChecks())
  return has(tb, name) && typeof tb[name] === 'function' ? tb[name] : null
}

// [code, argument] for a schema a loop can check in place, read from the
// schema without building a closure; else the schema's check, code 0.
function inline (V, s) {
  if (isMap(s)) {
    let type, cn = false, cv, en, a, b, other = false
    for (const k in s) {
      const v = s[k]
      if (v === undefined) continue
      switch (k) {
        case 'type': type = v; break
        case 'const': cn = true; cv = v; break
        case 'enum': en = v; break
        case 'minimum': case 'minLength': if (typeof v === 'number') a = v; else if (k === 'minLength') other = true; break
        case 'maximum': case 'maxLength': if (typeof v === 'number') b = v; else if (k === 'maxLength') other = true; break
        default: if (KW.has(k)) other = true
      }
    }
    const m = type === undefined ? 127 : typeof type === 'string' ? maskOf(type) : 0
    if (!other && m !== 0) {
      const strLen = 'minLength' in s || 'maxLength' in s
      const bound = a !== undefined || b !== undefined
      const lohi = [a === undefined ? (strLen ? 0 : -Infinity) : a, b === undefined ? Infinity : b]
      if (!cn && en === undefined) {
        if (!bound) { const c = type === undefined ? 6 : m === S_ ? 1 : m === N_ ? 2 : m === I_ ? 3 : m === B_ ? 4 : m === Z_ ? 5 : 0; if (c !== 0) return [c, CHECKS[c]] }
        else if (strLen ? m === S_ : m === I_ || m === N_) return [strLen ? 10 : m === I_ ? 8 : 9, lohi]
      } else if (!bound) {
        if (cn && en === undefined && (cv === null || typeof cv !== 'object') && cv === cv && (bits(cv) & m) !== 0) return [7, cv]
        if (!cn && en.length > 0 && allStr(en) && (m & S_) !== 0) return [11, en]
      }
    }
  }
  const f = get(V, s)
  const c = CODE.get(f)
  return c === undefined ? [0, f] : [c, f]
}
const CHECKS = [null, STR, NUM, INT, BOOL, NUL, T]

function build (V, s) {
  // Keyword values, read once, as the interpreter reads them (for-in).
  let type, en, cn = false, cv
  let mn, mx, xmn, xmx, mo, lo, hi, pat, fm, fmName
  let mi, ma, uq = false, pre, items, ct, mic, mac
  let props, req, mip, map, dr, pn, pp, ap, ds, pd
  let rf, all, any, one, not, iff, then, els, up, ui
  let sub = false
  for (const k in s) {
    const v = s[k]
    if (v === undefined) continue
    switch (k) {
      case 'type': type = v; break
      case 'enum': en = v; break
      case 'const': cn = true; cv = v; break
      case 'minimum': if (typeof v === 'number') mn = v; break
      case 'maximum': if (typeof v === 'number') mx = v; break
      case 'exclusiveMinimum': if (typeof v === 'number') xmn = v; break
      case 'exclusiveMaximum': if (typeof v === 'number') xmx = v; break
      case 'multipleOf': if (typeof v === 'number') mo = v; break
      case 'minLength': lo = v; break
      case 'maxLength': hi = v; break
      case 'pattern': pat = v; break
      case 'format': fm = format(V, v); fmName = v; break
      case 'minItems': mi = v; break
      case 'maxItems': ma = v; break
      case 'uniqueItems': uq = v === true; break
      case 'prefixItems': if (isArr(v)) { pre = v; sub = true } break
      case 'items': items = v; sub = true; break
      case 'contains': ct = v; sub = true; break
      case 'minContains': mic = v; break
      case 'maxContains': mac = v; break
      case 'properties': if (isMap(v)) { props = v; sub = true } break
      case 'required': if (isArr(v)) req = v; break
      case 'minProperties': mip = v; break
      case 'maxProperties': map = v; break
      case 'dependentRequired': if (isMap(v)) dr = v; break
      case 'propertyNames': pn = v; sub = true; break
      case 'patternProperties': if (isMap(v)) { pp = v; sub = true } break
      case 'additionalProperties': ap = v; sub = true; break
      case 'dependentSchemas': if (isMap(v)) { ds = v; sub = true } break
      case 'propertyDependencies': if (isMap(v)) { pd = v; sub = true } break
      case '$ref': if (typeof v === 'string') { rf = V.targets.get(s); sub = true } break
      case 'allOf': if (isArr(v)) { all = v; sub = true } break
      case 'anyOf': if (isArr(v)) { any = v; sub = true } break
      case 'oneOf': if (isArr(v)) { one = v; sub = true } break
      case 'not': not = v; sub = true; break
      case 'if': iff = v; sub = true; break
      case 'then': then = v; break
      case 'else': els = v; break
      case 'unevaluatedProperties': up = v; sub = true; break
      case 'unevaluatedItems': ui = v; sub = true; break
    }
  }
  const typed = type !== undefined
  const mask = typed ? maskOf(type) : -1
  const hasNum = mn !== undefined || mx !== undefined || xmn !== undefined || xmx !== undefined || mo !== undefined
  const hasStr = lo !== undefined || hi !== undefined || pat !== undefined || fm != null
  const hasArr = mi !== undefined || ma !== undefined || uq || pre !== undefined || items !== undefined || ct !== undefined
  const hasObj = props !== undefined || req !== undefined || mip !== undefined || map !== undefined || dr !== undefined || pn !== undefined || pp !== undefined || ap !== undefined || ds !== undefined || pd !== undefined

  // A leaf without subschemas: shared process-wide, unless its format is the
  // caller's.
  if (!sub && !hasArr && !hasObj) {
    const hasVal = en !== undefined || cn
    if (!hasNum && !hasStr && !hasVal) return mask === -1 ? T : mask === S_ ? STR : mask === N_ ? NUM : mask === I_ ? INT : mask === B_ ? BOOL : mask === Z_ ? NUL : intern(leaves, 't' + mask, () => typeOnly(mask))
    const make = () => leaf(typed, mask, en, cn, cv, hasNum, mn, mx, xmn, xmx, mo, hasStr, lo, hi, pat, fm)
    if (fm != null && V.fmts !== null && has(V.fmts, fmName)) return make()
    let key
    if (!hasVal) key = mask + ',' + mn + ',' + mx + ',' + xmn + ',' + xmx + ',' + mo + ',' + lo + ',' + hi + ',' + (fm != null ? fmName.length + ':' + fmName : '') + ',' + (pat === undefined ? '' : '/' + pat)
    else if (!hasNum && !hasStr) key = valueKey(mask, en, cn, cv)
    return key == null ? make() : intern(leaves, key, make)
  }

  const vf = en !== undefined || cn ? valueCheck(en, cn, cv) : null
  const sf = hasStr ? strCheck(false, lo, hi, pat, fm) : null
  const nf = hasNum ? numCheck(false, false, mn, mx, xmn, xmx, mo) : null
  const af = hasArr ? arrNode(V, mask === A_, mi, ma, uq, pre, items, ct, mic, mac) : null
  const of = hasObj ? objNode(V, mask === O_, props, req, mip, map, dr, pn, pp, ap, ds, pd) : null
  const groups = (sf !== null) + (nf !== null) + (af !== null) + (of !== null)

  // A node that holds only a $ref is its target's check (outside the
  // guarded tree, which needs the node to guard).
  if (rf !== undefined && !V.track && up === undefined && ui === undefined && !typed && vf === null && groups === 0 && all === undefined && any === undefined && one === undefined && not === undefined && iff === undefined) return ref(V, rf)

  const ip = []
  if (rf !== undefined) { let g = null; ip.push((d) => (g || (g = ref(V, rf)))(d)) }
  if (all !== undefined) { const fs = all.map(() => null); ip.push((d) => { for (let i = 0; i < fs.length; i++) if (!(fs[i] || (fs[i] = get(V, all[i])))(d)) return false; return true }) }
  if (any !== undefined) ip.push(union(V, any, true))
  if (one !== undefined) ip.push(union(V, one, false))
  if (not !== undefined) { let g = null; ip.push((d) => !(g || (g = get(V, not)))(d)) }
  if (iff !== undefined && (then !== undefined || els !== undefined)) {
    let fi = null, ft = then === undefined ? T : null, fe = els === undefined ? T : null
    ip.push((d) => (fi || (fi = get(V, iff)))(d) ? (ft || (ft = get(V, then)))(d) : (fe || (fe = get(V, els)))(d))
  }

  let f
  if (vf === null && ip.length === 0 && groups === 1 && ((af !== null && mask === A_) || (of !== null && mask === O_))) f = af || of
  else if (vf === null && !typed && groups === 0 && ip.length === 1) f = ip[0]
  else if (vf === null && !typed && ip.length === 0 && groups === 1 && (af !== null || of !== null)) f = af || of
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
  if (up !== undefined || ui !== undefined) {
    const f0 = f, U = { up, upf: null, ui, uif: null }
    f = (d) => f0(d) && unevaluated(V, s, U, d)
  }
  if (rf === undefined || !V.track) return f
  const st = V.stack
  return (d) => {
    for (let i = st.length - 2; i >= 0; i -= 2) if (st[i] === s && st[i + 1] === d) return true
    st.push(s, d)
    const ok = f(d)
    st.length -= 2
    return ok
  }
}

// ---------- unevaluated ----------

// unevaluatedProperties and unevaluatedItems, checked after the rest of the
// node passed. Which names and indexes the node evaluated follows from its
// subschemas and the value: a subschema that passed evaluates what its own
// keywords name, and among anyOf, oneOf and if, only the branches that pass
// count, which are asked again here. Nothing is collected on the way down,
// so a schema without these keywords pays nothing for them.
function unevaluated (V, s, U, d) {
  if (U.up !== undefined && bits(d) === O_) {
    const out = new Set()
    if (!collect(V, s, d, out, null, [], true)) {
      for (const k of keysOf(d)) if (!out.has(k) && !(U.upf || (U.upf = get(V, U.up)))(d[k])) return false
    }
  }
  if (U.ui !== undefined && isArr(d)) {
    const at = { upto: 0, set: new Set() }
    if (!collect(V, s, d, null, at, [], true)) {
      for (let i = at.upto; i < d.length; i++) if (!at.set.has(i) && !(U.uif || (U.uif = get(V, U.ui)))(d[i])) return false
    }
  }
  return true
}
const checkOf = (V, c) => { const m = V.memo || (V.memo = new WeakMap()); let f = isMap(c) ? m.get(c) : undefined; if (f === undefined) { f = get(V, c); if (isMap(c)) m.set(c, f) } return f }

// What `s`, which passed, evaluated of `d`: property names into `out`, or
// item indexes into `at` (a prefix length and a set). True when it evaluated
// all of them. `path` stops a reference cycle that reads no data, which
// evaluates nothing, as in the walk.
function collect (V, s, d, out, at, path, top) {
  if (!isMap(s) || path.includes(s)) return false
  path.push(s)
  const r = collectIn(V, s, d, out, at, path, top)
  path.pop()
  return r
}
function collectIn (V, s, d, out, at, path, top) {
  const sub = (c) => collect(V, c, d, out, at, path, false)
  if (out !== null) {
    if ((!top && s.unevaluatedProperties !== undefined) || s.additionalProperties !== undefined) return true
    const ps = isMap(s.properties) ? s.properties : null
    const pp = isMap(s.patternProperties) ? names(s.patternProperties).map(pattern) : null
    if (ps !== null || pp !== null) for (const k of keysOf(d)) if ((ps !== null && propEnum.call(ps, k)) || (pp !== null && pp.some((re) => re.test(k)))) out.add(k)
  } else {
    if ((!top && s.unevaluatedItems !== undefined) || s.items !== undefined) return true
    if (isArr(s.prefixItems)) at.upto = Math.max(at.upto, Math.min(d.length, s.prefixItems.length))
    if (s.contains !== undefined) { const c = checkOf(V, s.contains); for (let i = 0; i < d.length; i++) if (c(d[i])) at.set.add(i) }
  }
  if (typeof s.$ref === 'string' && V.targets !== null && sub(V.targets.get(s))) return true
  if (isArr(s.allOf)) for (const c of s.allOf) if (sub(c)) return true
  if (isArr(s.anyOf)) for (const c of s.anyOf) if (checkOf(V, c)(d) && sub(c)) return true
  if (isArr(s.oneOf)) for (const c of s.oneOf) if (checkOf(V, c)(d)) return sub(c)
  if (s.if !== undefined) {
    if (checkOf(V, s.if)(d)) { if (sub(s.if) || (s.then !== undefined && sub(s.then))) return true } else if (s.else !== undefined && sub(s.else)) return true
  }
  if (bits(d) === O_) {
    if (isMap(s.dependentSchemas)) for (const p of Object.entries(s.dependentSchemas)) if (has(d, p[0]) && sub(p[1])) return true
    if (isMap(s.propertyDependencies)) {
      for (const p of Object.entries(s.propertyDependencies)) {
        const v = has(d, p[0]) ? d[p[0]] : undefined
        if (typeof v === 'string' && isMap(p[1]) && has(p[1], v) && sub(p[1][v])) return true
      }
    }
  }
  return false
}

// Names the interpreter reads as keywords; any other name is an annotation.
const KW = new Set('$ref $id $anchor $dynamicRef $recursiveRef $dynamicAnchor $recursiveAnchor type enum const minimum maximum exclusiveMinimum exclusiveMaximum multipleOf minLength maxLength pattern format minItems maxItems uniqueItems prefixItems items contains minContains maxContains properties required minProperties maxProperties dependentRequired propertyNames patternProperties additionalProperties dependentSchemas propertyDependencies unevaluatedProperties unevaluatedItems allOf anyOf oneOf not if then else $defs definitions'.split(' '))

// anyOf / oneOf.
function union (V, list, anyOf) {
  const n = list.length
  const fs = list.map(() => null)
  const at = (i) => fs[i] || (fs[i] = get(V, list[i]))
  // Every branch an object that requires the same property to hold a
  // different string constant: the value of that property picks the only
  // branch that can pass.
  const tag = tagOf(list)
  if (tag !== null) {
    const name = tag[0], values = tag[1]
    return (d) => {
      if (typeof d !== 'object' || d === null || isArr(d)) return false
      const v = d[name]
      for (let i = 0; i < n; i++) if (values[i] === v) return (fs[i] || at(i))(d)
      return false
    }
  }
  // Branches that name types and nothing else: one test of the union.
  if (anyOf && n > 0 && list.every((b) => isMap(b) && b.type !== undefined && keysOf(b).every((k) => k === 'type' || !KW.has(k)))) {
    let m = 0
    for (const b of list) m |= maskOf(b.type)
    return intern(leaves, 't' + m, () => typeOnly(m))
  }
  const all = anyOf
    ? (d) => { for (let i = 0; i < n; i++) if ((fs[i] || at(i))(d)) return true; return false }
    : (d) => { let c = 0; for (let i = 0; i < n; i++) if ((fs[i] || at(i))(d) && ++c > 1) return false; return c === 1 }
  // Every branch a closed object: an own key declared by one branch only
  // (and required there, for oneOf) leaves that branch the only one that can
  // pass, and a key no branch declares leaves none. The first key for-in
  // yields is asked; it is own unless the object has no own enumerable key,
  // which the paths that answer false or fall back ask with has().
  const own = owners(V, list, anyOf)
  if (own === null) return all
  const names = own[0], idx = own[1], m = names.length
  return (d) => {
    if (typeof d === 'object' && d !== null && !isArr(d)) {
      for (const k in d) {
        let j = 0
        while (j < m && names[j] !== k) j++
        if (j === m) return has(d, k) ? false : all(d)
        const i = idx[j]
        if (i < 0) break
        return (fs[i] || at(i))(d) || (has(d, k) ? false : all(d))
      }
    }
    return all(d)
  }
}

// [names, branch of each name or -1] for a union of closed objects, or null.
function owners (V, list, anyOf) {
  const ns = [], idx = []
  for (let i = 0; i < list.length; i++) {
    let b = list[i]
    if (isMap(b) && typeof b.$ref === 'string' && V.targets !== null && keysOf(b).every((k) => k === '$ref' || !KW.has(k))) b = V.targets.get(b)
    if (!isMap(b) || b.additionalProperties !== false || b.patternProperties !== undefined || !isMap(b.properties)) return null
    const req = allStr(b.required) ? b.required : []
    for (const k of names(b.properties)) {
      const j = ns.indexOf(k)
      if (j >= 0) idx[j] = -1
      else { ns.push(k); idx.push(anyOf || req.includes(k) ? i : -1) }
    }
  }
  return [ns, idx]
}

function tagOf (list) {
  const b0 = list[0]
  if (list.length < 2 || !isMap(b0) || !allStr(b0.required)) return null
  for (const name of b0.required) {
    const values = []
    for (const b of list) {
      if (!isMap(b) || b.type !== 'object' || !allStr(b.required) || !b.required.includes(name) || !isMap(b.properties)) return null
      const p = b.properties[name]
      const c = isMap(p) && has(b.properties, name) ? p.const : undefined
      if (typeof c !== 'string' || values.includes(c)) break
      values.push(c)
    }
    if (values.length === list.length) return [name, values]
  }
  return null
}

// ---------- objects ----------

// Declared properties as entries of three: name, code (REQ added where the
// name is required, LAZY until the property is compiled), argument.
// `X` holds what a declared object rarely has: patternProperties,
// additionalProperties as a schema, propertyNames, property counts,
// dependencies and required names that are not declared.
function objNode (V, g, props, req, mip, map, dr, pn, pp, ap, ds, pd) {
  const ks = props === undefined ? [] : names(props)
  const n = ks.length
  const e = []
  for (const k of ks) e.push(k, LAZY, null)
  let nReq = 0, xr = null
  if (req !== undefined) {
    for (const k of req) {
      const i = ks.indexOf(k)
      if (i < 0) { if (xr === null) xr = []; if (!xr.includes(k)) xr.push(k) } else if (e[3 * i + 1] < REQ) { e[3 * i + 1] |= REQ; nReq++ }
    }
  }
  const closed = ap === false
  const ps = pp === undefined ? null : names(pp)
  // Many declared names: looked up in a map, and the names a value lacks are
  // not asked for one by one (see absent).
  const B = n > 16 ? { ix: new Map(ks.map((k, i) => [k, 3 * i])), rqs: ks.map((k, i) => 3 * i).filter((j) => e[j + 1] >= REQ) } : null
  const X = ps === null && (ap === undefined || ap === true || closed) && pn === undefined && mip === undefined && map === undefined && dr === undefined && ds === undefined && pd === undefined && xr === null
    ? null
    : {
        res: ps === null ? null : ps.map(pattern), pss: ps === null ? null : ps.map((k) => pp[k]), pfs: ps === null ? null : ps.map(() => null),
        ap: ap === undefined || ap === true || closed ? undefined : ap, apf: null, pn, pnf: null,
        lo: mip === undefined ? 0 : mip, hi: map === undefined ? Infinity : map,
        dr, deps: dr === undefined ? null : names(dr), ds, dss: ds === undefined ? null : names(ds), dsf: ds === undefined ? null : names(ds).map(() => null), xr,
        pd: pd === undefined ? null : Object.entries(pd).filter((p) => isMap(p[1])).map((p) => [p[0], new Map(Object.entries(p[1]).map((q) => [q[0], [q[1], null]]))])
      }
  return X === null ? declared(V, g, props, e.slice(), n, nReq, closed, B) : general(V, g, props, e.slice(), n, closed, X, B)
}

// Declared properties only, open or closed.
function declared (V, g, props, e, n, nReq, closed, B) {
  return (o) => {
    if (typeof o !== 'object' || o === null || isArr(o)) return !g
    let hits = 0, seen = 0, next = 0, count = 0, last
    for (const k in o) {
      last = k
      count++
      let i = next
      if (e[i] !== k) {
        if (B !== null) { const j = B.ix.get(k); i = j === undefined ? 3 * n : j } else { i = 0; while (i < 3 * n && e[i] !== k) i += 3 }
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

function general (V, g, props, e, n, closed, X, B) {
  return (o) => {
    if (typeof o !== 'object' || o === null || isArr(o)) return !g
    let hits = 0, seen = 0, count = 0, last
    for (const k in o) {
      last = k
      count++
      const r = key(V, props, e, n, closed, X, o, k, B)
      if (r < 0) return has(o, k) ? false : exactObj(V, props, e, n, closed, X, o, B)
      if (r > 0) { hits++; seen |= 1 << ((r - 1) & 31) }
    }
    if (last !== undefined && !has(o, last)) return exactObj(V, props, e, n, closed, X, o, B)
    return finish(V, props, e, n, X, o, hits, seen, count, B)
  }
}

// Compiles declared property i and records its code and argument.
function prop (V, props, e, i) {
  const r = inline(V, props[e[i]])
  e[i + 1] = r[0] | (e[i + 1] & REQ)
  e[i + 2] = r[1]
}
const valueAt = (V, props, e, i, x) => { if ((e[i + 1] & 15) === LAZY) prop(V, props, e, i); return leafOk(e[i + 1] & 15, e[i + 2], x) }
const sub = (fs, list, i, V) => fs[i] || (fs[i] = get(V, list[i]))

// Declared names the for-in walk did not meet: absent, or own and not
// enumerable. A few are asked for by name; with more, the object's own names
// are read once, as the interpreter reads them.
function absent (V, props, e, n, seen, o, hits) {
  if (n - hits <= 5) {
    for (let i = 0; i < n; i++) {
      if (((seen >>> i) & 1) === 1) continue
      const k = e[3 * i]
      const x = has(o, k) ? o[k] : undefined
      if (x === undefined ? e[3 * i + 1] >= REQ : !valueAt(V, props, e, 3 * i, x)) return false
    }
    return true
  }
  for (let i = 0; i < n; i++) {
    if (((seen >>> i) & 1) === 1 || e[3 * i + 1] < REQ) continue
    const k = e[3 * i]
    if (!has(o, k)) return false
    const x = o[k]
    if (x === undefined || !valueAt(V, props, e, 3 * i, x)) return false
  }
  for (const k of Object.getOwnPropertyNames(o)) {
    if (propEnum.call(o, k)) continue
    let i = 0
    while (i < 3 * n && e[i] !== k) i += 3
    if (i === 3 * n || e[i + 1] >= REQ) continue
    const x = o[k]
    if (x !== undefined && !valueAt(V, props, e, i, x)) return false
  }
  return true
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

// One key of the general walk: -1 when it fails, else 1 + its declared
// index, or 0.
function key (V, props, e, n, closed, X, o, k, B) {
  let i = 0
  if (B !== null) { const j = B.ix.get(k); i = j === undefined ? 3 * n : j } else while (i < 3 * n && e[i] !== k) i += 3
  let r = 0, ev = i < 3 * n
  if (ev) { r = i / 3 + 1; const x = o[k]; if (x === undefined ? e[i + 1] >= REQ : !valueAt(V, props, e, i, x)) return -1 }
  if (X !== null) {
    if (X.res !== null) for (let j = 0; j < X.res.length; j++) if (X.res[j].test(k)) { ev = true; if (!sub(X.pfs, X.pss, j, V)(o[k])) return -1 }
    if (!ev && X.ap !== undefined && !(X.apf || (X.apf = get(V, X.ap)))(o[k])) return -1
    if (X.pn !== undefined && !(X.pnf || (X.pnf = get(V, X.pn)))(k)) return -1
  }
  if (!ev && closed) return -1
  return r
}

// After the keys: declared names not met, property counts, required names
// that are not declared, dependencies.
function finish (V, props, e, n, X, o, hits, seen, count, B) {
  if (X !== null && (count < X.lo || count > X.hi)) return false
  if (hits !== n && !(n > 31 ? bigAbsent(V, props, e, n, B, o, count, undefined) : absent(V, props, e, n, seen, o, hits))) return false
  if (X === null) return true
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

// The exact path: own enumerable keys from Object.keys.
function exactObj (V, props, e, n, closed, X, o, B) {
  let hits = 0, seen = 0
  const ks = keysOf(o)
  for (let j = 0; j < ks.length; j++) { const r = key(V, props, e, n, closed, X, o, ks[j], B); if (r < 0) return false; if (r > 0) { hits++; seen |= 1 << ((r - 1) & 31) } }
  return finish(V, props, e, n, X, o, hits, seen, ks.length, B)
}

// ---------- arrays ----------

function arrNode (V, g, mi, ma, uq, pre, items, ct, mic, mac) {
  const lo = mi === undefined ? 0 : mi
  const hi = ma === undefined ? Infinity : ma
  return pre === undefined && ct === undefined && !uq ? arrSimple(V, g, lo, hi, items) : arrGeneral(V, g, lo, hi, uq, pre, items, ct, mic, mac)
}

function arrSimple (V, g, lo, hi, items) {
  let code = items === undefined ? 6 : -1, it = null
  return (d) => {
    if (!isArr(d)) return !g
    const len = d.length
    if (len < lo || len > hi) return false
    for (let i = 0; i < len; i++) {
      const x = d[i]
      switch (code) {
        case 1: if (typeof x === 'string') continue; return false
        case 6: return true
        case 2: if (Number.isFinite(x)) continue; return false
        case 3: if (Number.isInteger(x)) continue; return false
        case 7: if (x === it) continue; return false
        case 8: if (Number.isInteger(x) && x >= it[0] && x <= it[1]) continue; return false
        case 9: if (Number.isFinite(x) && x >= it[0] && x <= it[1]) continue; return false
        case 10: if (typeof x === 'string' && lenOk(x, it[0], it[1])) continue; return false
        case 11: if (typeof x === 'string' && it.includes(x)) continue; return false
        case 0: if (it(x)) continue; return false
        case -1: { const r = inline(V, items); code = r[0]; it = r[1]; i--; continue }
      }
      if (!leafOk(code, it, x)) return false
    }
    return true
  }
}

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

// ---------- leaves ----------

const typeOnly = (mask) => (d) => (bits(d) & mask) !== 0

// A key for an enum or const leaf, or null when its values are not shared
// (an object or array, a number JSON cannot write).
function valueKey (mask, en, cn, cv) {
  const ok = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v)
  if ((en !== undefined && !en.every(ok)) || (cn && !ok(cv))) return null
  return 'v' + mask + JSON.stringify([en === undefined ? 0 : en, cn ? [cv] : 0])
}

function valueCheck (en, cn, cv) {
  if (cn && en === undefined) {
    if (cv !== null && typeof cv === 'object') return (d) => eq(cv, d)
    return (d) => d === cv
  }
  const prims = []; const objs = []
  for (const v of en) { if (v !== null && typeof v === 'object') objs.push(v); else if (v === v) prims.push(v) }
  const pf = prims.length > 8 ? ((set) => (d) => set.has(d))(new Set(prims)) : (d) => { for (let i = 0; i < prims.length; i++) if (prims[i] === d) return true; return false }
  const ef = objs.length === 0 ? pf : (d) => { if (d === null || typeof d !== 'object') return pf(d); for (let i = 0; i < objs.length; i++) if (eq(objs[i], d)) return true; return false }
  return cn ? (d) => ef(d) && eq(cv, d) : ef
}

function strCheck (g, lo, hi, pat, fm) {
  const min = lo === undefined ? 0 : lo
  const max = hi === undefined ? Infinity : hi
  const re = pat === undefined ? null : pattern(pat)
  const f = fm == null ? null : fm
  return (d) => {
    if (typeof d !== 'string') return !g
    if (!lenOk(d, min, max)) return false
    return (re === null || re.test(d)) && (f === null || !!f(d))
  }
}

function numCheck (g, int, mn, mx, xmn, xmx, mo) {
  const a = mn === undefined ? -Infinity : mn
  const b = mx === undefined ? Infinity : mx
  return (d) => {
    if (int ? !Number.isInteger(d) : !Number.isFinite(d)) return !g
    return d >= a && d <= b && (xmn === undefined || d > xmn) && (xmx === undefined || d < xmx) && (mo === undefined || multipleOk(d, mo))
  }
}

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

// ---------- entry ----------

// The second half (lib/core/verdict-full.js), loaded for the first schema
// this file does not take.
let fullModule = null
function full (root, opts, fmts) {
  const V = fmts === null ? PLAIN : new Ctx(null, fmts, false)
  return (fullModule || (fullModule = require('./verdict-full'))).createFull(root, opts, pattern, (name) => format(V, name))
}

function createVerdict (root, options) {
  const opts = options || {}
  if (opts.keywords || opts.coerce || opts.discriminator || (opts.numberFormats && keysOf(opts.numberFormats).length > 0)) return null
  if (typeof root === 'boolean') return root ? T : F
  const fmts = opts.formats || null
  const st = { root, refs: [], anchors: false, ids: false, walkThrows: false }
  if (!isMap(root) || !visit(root, 0, st)) return st.walkThrows ? null : full(root, opts, fmts)
  if (st.refs.length === 0) return build(fmts === null ? PLAIN : new Ctx(null, fmts, false), root)
  // References resolve here, each from the base of the resource it is in: a
  // base is known once the resources are indexed, and does not change at run
  // time. A reference that does not resolve fails every value, as in the
  // walk. A node the index did not record (a pointer into something that is
  // not a schema position) has no known base and goes to the second half.
  const flat = !st.anchors && !st.ids && !opts.schemaMap
  const state = indexSchemas(root, opts.schemaMap, flat)
  const baseOf = (n) => { const b = state.nodeBase.get(n); return b !== undefined ? b : flat ? state.rootBase : undefined }
  const targets = new Map()
  const seen = new Set()
  for (let i = 0; i < st.refs.length; i++) {
    const b = baseOf(st.refs[i])
    if (b === undefined) return full(root, opts, fmts)
    const r = resolveRef(st.refs[i].$ref, b, state)
    let t = r.node === undefined || r.node === false ? false : isMap(r.node) ? r.node : true
    if (isMap(t)) {
      if (baseOf(t) !== r.base) return full(root, opts, fmts)
      if (!seen.has(t)) { seen.add(t); if (!visit(t, 0, st)) return st.walkThrows ? null : full(root, opts, fmts) }
    }
    targets.set(st.refs[i], t)
  }
  const fn = build(new Ctx(targets, fmts, false), root)
  let guarded = null, gc = null
  return (d) => {
    try { return fn(d) } catch (e) {
      if (!(e instanceof RangeError)) throw e
      if (guarded === null) guarded = build((gc = new Ctx(targets, fmts, true)), root)
      gc.stack.length = 0
      return guarded(d)
    }
  }
}

module.exports = { createVerdict, _sequence: sequence }
