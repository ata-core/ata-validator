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

const { indexSchemas, resolveRef, compilePattern, splitFragment, resolveUri } = require('../engine-shared')
// The linearity proof (lib/regex-linear.js, with the pattern parser), loaded
// for the first pattern the sequence matcher does not take.
let linear = null
const nativeIsLinear = (src) => (linear || (linear = require('../regex-linear').nativeIsLinear))(src)

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
// Equality as the walk has it; two objects are compared by
// lib/unique-items.js, loaded with lib/core/verdict-more.js.
const eq = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && M().eq(a, b))
const isObj = (d) => typeof d === 'object' && d !== null && !isArr(d)
const allStr = (v) => { if (!isArr(v)) return false; for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return false; return true }

// Type bits as the interpreter has them: an integer also carries `number`, a
// number that is not finite carries none, an unknown type name matches all.
const S_ = 1, N_ = 2, I_ = 4, B_ = 8, Z_ = 16, O_ = 32, A_ = 64
const bitOf = (t) => {
  switch (t) {
    case 'string': return S_
    case 'number': return N_
    case 'integer': return I_
    case 'boolean': return B_
    case 'null': return Z_
    case 'object': return O_
    case 'array': return A_
  }
  return 127
}
const maskOf = (t) => { if (typeof t === 'string') return bitOf(t); let m = 0; for (const x of t) m |= bitOf(x); return m }
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

// ---------- schema facts ----------

const NOT_FLAT = /"\$(?:id|anchor|dynamicAnchor|recursiveAnchor)"/
const OP = Object.prototype
const META_REF = /"\$(?:ref|dynamicRef|recursiveRef)":"[^"]*json-schema\.org\//

// What the 2.0 Validator asks of a schema's JSON text, answered by walking
// the schema instead of writing the text: whether the text would hold
// "errorMessage", "default" or "format" as a token, a $ref, $dynamicRef or
// $recursiveRef naming a json-schema.org document (META_REF), and one of the
// NOT_FLAT names. Null where the walk cannot follow JSON.stringify (toJSON, a
// bigint, a cycle or very deep nesting): the text answers there, as before.
//
// Where a token can come from: JSON.stringify writes a quote inside a string
// as \", and after a string's closing quote comes `:`, `,`, `}` or `]`. So
// "word" (a quote, letters, a quote) is in the text of a string s exactly
// when s is the word (the quotes are its delimiters) or s ends with "word
// (an escaped quote, the word, the closing delimiter). Every word ends in d,
// e, r or t, so most strings are answered by their last character.
function factStr (f, s) {
  const n = s.length
  if (n < 3) return
  switch (s.charCodeAt(n - 1)) {
    case 101: if (s === 'errorMessage' || s.endsWith('"errorMessage')) f.errorMessage = true; return
    case 116:
      if (s === 'default' || s.endsWith('"default')) f.default = true
      else if (s === 'format' || s.endsWith('"format')) f.format = true
      return
    case 100: if (s === '$id' || s.endsWith('"$id')) f.notFlat = true; return
    case 114: if (s === '$anchor' || s === '$dynamicAnchor' || s === '$recursiveAnchor' || s.endsWith('"$anchor') || s.endsWith('"$dynamicAnchor') || s.endsWith('"$recursiveAnchor')) f.notFlat = true
  }
}
// JSON.stringify calls a toJSON it finds on a value, own or inherited, and
// writes a boxed string, number or boolean as the value it holds, which its
// keys do not show: an object whose constructor is not Object (or Array, for
// a list) or that has a toJSON is left to the text. Read as a constructor and
// a toJSON, which hit the same caches for every object of a shape.
const hop = OP.hasOwnProperty
// A map or list the scan reads itself rather than through factWalk. The
// test is written out at each place it is made, so each read has the
// shapes of that place only.
const plainFor = (st, v) => { if ((v.constructor !== Object && !isArr(v)) || typeof v.toJSON === 'function') st.f = null }
function factWalk (f, x, depth) {
  if (typeof x === 'string') { factStr(f, x); return true }
  if (typeof x !== 'object' || x === null) return typeof x !== 'bigint'
  if (depth > 200 || (x.constructor !== Object && !isArr(x)) || typeof x.toJSON === 'function') return false
  if (isArr(x)) { for (let i = 0; i < x.length; i++) if (!factWalk(f, x[i], depth + 1)) return false; return true }
  for (const k in x) {
    if (!hop.call(x, k)) continue
    const v = x[k]
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
    factKey(f, k, v)
    if (!factWalk(f, v, depth + 1)) return false
  }
  return true
}
function facts (schema) {
  const f = newFacts()
  return factWalk(f, schema, 0) ? f : null
}
// The same questions asked of the text, as _build asked them before.
function textFacts (schema) {
  const text = JSON.stringify(schema) || ''
  return { errorMessage: text.includes('"errorMessage"'), default: text.includes('"default"'), format: text.includes('"format"'), metaRef: text.includes('json-schema.org/') && META_REF.test(text), notFlat: NOT_FLAT.test(text) }
}

// ---------- scan ----------

// Every place the resource index walks, and the targets of references.
// False when the schema holds anything this file does not implement.
// Each keyword the walk reads has a code, by a switch on the name (a
// compare of interned names each, which measured faster than a lookup in a
// table of the names); 0 for any other name.
function kw (k) {
  // The common names first.
  switch (k) {
    case 'type': return 24
    case 'properties': return 3
    case 'required': return 23
    case '$ref': return 8
    case 'items': case 'not': case 'if': case 'then': case 'else': return 15
    case 'additionalProperties': return 9
    case 'enum': return 13
    case 'default': case 'errorMessage': case 'format': return 16
    case 'allOf': case 'anyOf': case 'oneOf': return 10
    case 'const': return 12
    case 'minLength': case 'maxLength': case 'minItems': case 'maxItems': case 'minContains': case 'maxContains': return 18
    case 'pattern': return 20
    case '$defs': case 'definitions': return 2
    case '$id': return 6
    case 'prefixItems': return 11
    case 'contains': case 'propertyNames': return 14
    case 'patternProperties': return 21
    case 'uniqueItems': return 26
    case 'minProperties': case 'maxProperties': return 19
    case 'dependentRequired': return 17
    case 'dependentSchemas': return 4
    case '$anchor': case '$dynamicAnchor': return 1
    case '$dynamicRef': return 5
    case 'unevaluatedItems': case 'unevaluatedProperties': return 25
    case 'propertyDependencies': return 22
    case '$recursiveAnchor': case '$recursiveRef': return 7
  }
  return 0
}
function visit (s, depth, st) {
  if (typeof s !== 'object' || s === null) { if (st.f !== null) factOf(st, s); return true }
  if (depth > 500) return false
  // The facts the Validator asks (see factWalk) are gathered on the same
  // walk, from every own key and string the text would hold. Where the walk
  // cannot stand for the text (an object that is not plain, a toJSON, an
  // inherited name) the facts are left to factWalk.
  if (st.f !== null && ((s.constructor !== Object && !isArr(s)) || typeof s.toJSON === 'function')) st.f = null
  // Once a schema has a reference, nodes are remembered, so a target the walk
  // has already been through is not walked again.
  if (st.seen !== null) { if (st.seen.has(s)) return true; st.seen.add(s) }
  // The entries of the properties map this walk met, and the required names.
  let pe = null, rq
  for (const k in s) {
    // for-in gives inherited names too, which JSON.stringify does not write:
    // with one (a prototype with enumerable names) the facts are left to
    // factWalk.
    if (st.f !== null && !hop.call(s, k)) st.f = null
    const v = s[k]
    if (v === undefined) continue
    const c = kw(k)
    // A name that is no keyword this walk reads: only the facts ask it.
    if (c === 0) { if (st.f !== null) { factKey(st.f, k, v); factOf(st, v) } continue }
    let w = false
    switch (c) {
      // A keyword's name is asked only where it is one of the words; the
      // others hold none and no quote.
      case 16: if (st.f !== null) factKey(st.f, k, v); break
      case 5: if (st.f !== null) factKey(st.f, k, v); if (typeof v === 'string') (st.drefs === NONE ? st.drefs = [] : st.drefs).push(s); break
      case 8: if (st.f !== null) factKey(st.f, k, v); if (typeof v === 'string') { if (st.refs === NONE) { st.refs = []; if (st.seen === null) st.seen = new Set() } st.refs.push(s) } break
      case 6: if (st.f !== null) st.f.notFlat = true; if (typeof v === 'string' && s !== st.root) st.ids = true; break
      case 1: if (st.f !== null) st.f.notFlat = true; if (typeof v === 'string') st.anchors = true; break
      case 7: return false
      case 25: st.more = true; w = true; if (!visit(v, depth + 1, st)) return false; break
      case 22:
        st.more = true
        if (isMap(v)) {
          w = true
          if (st.f !== null) plainFor(st, v)
          for (const p of Object.entries(v)) {
            if (st.f !== null) factStr(st.f, p[0])
            if (isMap(p[1])) { if (st.f !== null) plainFor(st, p[1]); for (const q of Object.entries(p[1])) { if (st.f !== null) factStr(st.f, q[0]); if (!visit(q[1], depth + 1, st)) return false } } else if (st.f !== null) factOf(st, p[1])
          }
        }
        break
      case 24: if (typeof v !== 'string' && !allStr(v)) return false; break
      case 18: if (typeof v !== 'number') return false; break
      case 19: if (typeof v !== 'number') return false; st.more = true; break
      case 20: if (typeof v !== 'string') return false; pats(st, v); break
      // enum and required that are not lists (null reads as absent) are
      // thrown by createVerdict, from the first the walk meets.
      case 23: if (isArr(v)) { if (!allStr(v)) return false; rq = v; w = true; if (st.f !== null) plainFor(st, v) } else if (v !== null && st.shape === null) st.shape = k; break
      case 13: if (!isArr(v)) { if (v !== null && st.shape === null) st.shape = k; break } if (v.some((x) => x !== null && typeof x === 'object')) st.more = true; break
      case 12: if (isMap(v) || isArr(v)) st.more = true; break
      case 26: if (v === true) st.more = true; break
      case 9: if (v !== true && v !== false) st.more = true; w = true; if (!visit(v, depth + 1, st)) return false; break
      case 17: st.more = true; if (isMap(v)) for (const p of Object.entries(v)) if (!allStr(p[1])) return false; break
      case 21: st.more = true; if (isMap(v)) { w = true; if (st.f !== null) plainFor(st, v); for (const p of Object.entries(v)) { if (st.f !== null) factStr(st.f, p[0]); pats(st, p[0]); if (!visit(p[1], depth + 1, st)) return false } } break
      case 4: st.more = true
      // falls through
      case 2: case 3:
        if (isMap(v)) {
          w = true
          if (st.f !== null) plainFor(st, v)
          // The map's own enumerable names, as Object.entries gives them, each
          // value read once.
          const ns = keysOf(v)
          if (c === 3) { pe = ns; if (s === st.root) { st.pm = v; st.pe = ns } if (ns.length > 16) st.more = true }
          for (let i = 0; i < ns.length; i++) {
            const x = v[ns[i]]
            if (x === false && c === 3) st.falses = true
            if (st.f !== null) factStr(st.f, ns[i])
            if (!visit(x, depth + 1, st)) return false
          }
        }
        break
      case 14: st.more = true
      // falls through
      case 15:
        w = true
        if (!visit(v, depth + 1, st)) return false
        break
      case 11: st.more = true
      // falls through
      case 10:
        if (isArr(v)) { w = true; if (st.f !== null) plainFor(st, v); for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === false) st.falses = true; if (!visit(x, depth + 1, st)) return false } }
        break
    }
    if (!w && st.f !== null) factOf(st, v)
  }
  // Required names that are not all declared properties take the second
  // half's object record. Declared ones were asked with the properties; the
  // others are asked here.
  if (rq !== undefined) {
    let all = pe !== null && pe.length <= 16
    for (let i = 0; all && i < rq.length; i++) { let j = 0; while (j < pe.length && pe[j] !== rq[i]) j++; if (j === pe.length) all = false }
    if (!all) { st.more = true; if (st.f !== null) factOf(st, rq) }
  }
  return true
}
const factOf = (st, v) => { if (typeof v === 'string') factStr(st.f, v); else if (typeof v === 'bigint') st.f = null; else if (typeof v === 'object' && v !== null && !factWalk(st.f, v, 0)) st.f = null }
const refKey = (k) => k === '$ref' || k === '$dynamicRef' || k === '$recursiveRef' || k.endsWith('"$ref') || k.endsWith('"$dynamicRef') || k.endsWith('"$recursiveRef')
function factKey (f, k, v) {
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return
  factStr(f, k)
  // "$ref":" is in the text only where a key is the word or ends with "word
  // (as for factStr), and the value follows it. Each such word ends in f.
  if (!f.metaRef && typeof v === 'string' && k.charCodeAt(k.length - 1) === 102 && refKey(k) && v.includes('json-schema.org/') && META_REF.test(JSON.stringify(k) + ':' + JSON.stringify(v))) f.metaRef = true
}

// ---------- compile ----------

// A validator's compile state: how references resolve, the caller's formats,
// and whether the tree keeps the cycle guard.
function Ctx (targets, fmts, track, dyn, scope, stack) {
  this.targets = targets
  // With $dynamicRef: the index, the targets each $dynamicRef can take, the
  // nodes that enter a base, and the dynamic scope this context compiles
  // under (each base once, in the order first entered: a base entered again
  // further in cannot change which anchor the outermost-first search finds).
  this.dyn = dyn || null
  this.scope = scope || null
  this.kids = null
  this.fmts = fmts
  this.track = track
  this.byTarget = targets === null ? null : new Map()
  this.stack = stack || (track ? [] : null)
  // No declared property's schema and no allOf, anyOf or oneOf member is
  // false, and no subschema is a reference: never() has nothing to find
  // (those are the only places it looks), and is not asked.
  this.sure = false
}
const PLAIN = new Ctx(null, null, false)
const SURE = new Ctx(null, null, false)
SURE.sure = true
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

// The code for a schema a loop can check in place, read from the schema
// without building a closure, with its argument left in IA; else code 0 and
// the schema's check.
let IA = null
const pair = (c, a) => { IA = a; return c }
function inline (V, s) {
  if (isMap(s)) {
    let type, cn = false, cv, en, a, b, other = false
    for (const k in s) {
      const v = s[k]
      if (v === undefined) continue
      switch (k) {
        case 'type': type = v; break
        case 'const': cn = true; cv = v; break
        case 'enum': if (v !== null) en = v; break
        case 'minimum': case 'minLength': if (typeof v === 'number') a = v; else if (k === 'minLength') other = true; break
        case 'maximum': case 'maxLength': if (typeof v === 'number') b = v; else if (k === 'maxLength') other = true; break
        default: if (KW.has(k)) other = true
      }
    }
    const m = type === undefined ? 127 : typeof type === 'string' ? maskOf(type) : 0
    if (!other && m !== 0) {
      const bound = a !== undefined || b !== undefined
      if (!cn && en === undefined) {
        if (!bound) { const c = type === undefined ? 6 : m === S_ ? 1 : m === N_ ? 2 : m === I_ ? 3 : m === B_ ? 4 : m === Z_ ? 5 : 0; if (c !== 0) return pair(c, CHECKS[c]) } else {
          const strLen = 'minLength' in s || 'maxLength' in s
          if (strLen ? m === S_ : m === I_ || m === N_) return pair(strLen ? 10 : m === I_ ? 8 : 9, [a === undefined ? (strLen ? 0 : -Infinity) : a, b === undefined ? Infinity : b])
        }
      } else if (!bound) {
        if (cn && en === undefined && (cv === null || typeof cv !== 'object') && cv === cv && (bits(cv) & m) !== 0) return pair(7, cv)
        if (!cn && en.length > 0 && allStr(en) && (m & S_) !== 0) return pair(11, en)
      }
    }
  }
  const f = get(V, s)
  const c = CODE.get(f)
  return pair(c === undefined ? 0 : c, f)
}
const CHECKS = [null, STR, NUM, INT, BOOL, NUL, T]

function build (V, s) {
  if (V.dyn !== null) { const W = M().enter(V, s); if (W !== V) return build(W, s) }
  // Keyword values, read once, as the interpreter reads them (for-in).
  let type, en, cn = false, cv
  let mn, mx, xmn, xmx, mo, lo, hi, pat, fm, fmName
  let mi, ma, uq = false, pre, items, ct, mic, mac
  let props, req, mip, map, dr, pn, pp, ap, ds, pd
  let rf, all, any, one, not, iff, then, els, up, ui, dr$
  let sub = false
  for (const k in s) {
    const v = s[k]
    if (v === undefined) continue
    switch (k) {
      case 'type': type = v; break
      case 'enum': if (v !== null) en = v; break
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
      case '$dynamicRef': if (typeof v === 'string') { dr$ = M().dynamicTarget(V, V.dyn.refs.get(s)); sub = true } break
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
  if ((rf !== undefined || all !== undefined || any !== undefined || one !== undefined) && !V.sure && never(V, s, 0)) return F
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
  if (dr$ !== undefined && rf === undefined) { rf = dr$; dr$ = undefined }
  if (rf !== undefined && !V.track && dr$ === undefined && up === undefined && ui === undefined && !typed && vf === null && groups === 0 && all === undefined && any === undefined && one === undefined && not === undefined && iff === undefined) return ref(V, rf)

  const ip = []
  // A reference's check, resolved at its first call and then called in
  // place of this one.
  if (rf !== undefined) { const j = ip.length; ip.push((d) => (ip[j] = ref(V, rf))(d)) }
  if (dr$ !== undefined) { let g = null; const t = dr$; ip.push((d) => (g || (g = ref(V, t)))(d)) }
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
  // An object or array group, which passes a value of another type itself,
  // and one applicator, asked first: a reference that fails on the names
  // alone (such as unevaluatedProperties: false next to nothing that
  // evaluates) answers before the group walks the value's keys.
  else if (vf === null && !typed && ip.length === 1 && groups === 1 && (af !== null || of !== null)) { const a = af || of; f = (d) => ip[0](d) && a(d) }
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
    // unevaluated*, after the rest of the node (lib/core/verdict-more.js).
    const U = { up, upf: null, ui, uif: null, P: null }
    f = M().unevaluatedNode(V, s, f, U, vf === null && ip.length === 0 && groups === 0 && !typed)
  }
  if ((rf === undefined && dr$ === undefined) || !V.track) return f
  const st = V.stack
  return (d) => {
    for (let i = st.length - 2; i >= 0; i -= 2) if (st[i] === s && st[i + 1] === d) return true
    st.push(s, d)
    const ok = f(d)
    st.length -= 2
    return ok
  }
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

// The root's properties map and its names as the scan read them, while the
// root is built: they are not read again.
let rootProps = null, rootEntries = null

// Declared properties as entries of three: name, code (REQ added where the
// name is required, LAZY until the property is compiled), argument.
// `X` holds what a declared object rarely has: patternProperties,
// additionalProperties as a schema, propertyNames, property counts,
// dependencies and required names that are not declared.
function objNode (V, g, props, req, mip, map, dr, pn, pp, ap, ds, pd) {
  let ks
  if (props === undefined) ks = []
  else if (props === rootProps) { ks = rootEntries; rootProps = rootEntries = null } else ks = names(props)
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
    : M().xRecord(ps, pp, ap, closed, pn, mip, map, dr, ds, xr, pd)
  const f = X === null ? declared(V, g, props, e, n, nReq, closed, B) : general(V, g, props, e, n, closed, X, B)
  // A declared property whose schema can never pass (false, or a reference
  // that does not resolve) fails every object that has it: asked first, so a
  // value is not walked in its key order to find that out.
  // Only a few: each is asked of every object, valid ones included.
  if (V.sure) return f
  const doomed = ks.filter((k) => never(V, props[k]))
  if (doomed.length === 0 || doomed.length > 2) return f
  return (o) => {
    if (typeof o === 'object' && o !== null && !isArr(o)) for (let i = 0; i < doomed.length; i++) if (has(o, doomed[i]) && o[doomed[i]] !== undefined) return false
    return f(o)
  }
}
// Whether a subschema fails every value: false, a reference that does not
// resolve or leads to such a schema, an allOf with such a member, an anyOf
// or oneOf whose branches all are such. Its node fails before anything else
// is looked at, and so does an object with a property of it.
function never (V, s, depth) {
  if (s === false) return true
  if (!isMap(s) || (depth | 0) > 8) return false
  const d = (depth | 0) + 1
  if (typeof s.$ref === 'string' && V.targets !== null) { const t = V.targets.get(s); if (t === false || (isMap(t) && never(V, t, d))) return true }
  if (isArr(s.allOf) && s.allOf.some((c) => never(V, c, d))) return true
  return (isArr(s.anyOf) && s.anyOf.every((c) => never(V, c, d))) || (isArr(s.oneOf) && s.oneOf.every((c) => never(V, c, d)))
}

// Declared properties only, open or closed.
function declared (V, g, props, e, n, nReq, closed, B) {
  if (B !== null) return M().declaredBig(V, g, props, e, n, nReq, closed, B)
  return (o) => {
    if (typeof o !== 'object' || o === null || isArr(o)) return !g
    let hits = 0, seen = 0, next = 0, last
    for (const k in o) {
      last = k
      let i = next
      if (e[i] !== k) {
        i = 0
        while (i < 3 * n && e[i] !== k) i += 3
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
    if (hits !== n && !absent(V, props, e, n, seen, o, hits)) return false
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
  e[i + 1] = inline(V, props[e[i]]) | (e[i + 1] & REQ)
  e[i + 2] = IA
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


// One key of the general walk: -1 when it fails, else 1 + its declared
// index, or 0.
function key (V, props, e, n, closed, X, o, k, B) {
  let i = 0
  if (B !== null) { const j = B.ix.get(k); i = j === undefined ? 3 * n : j } else while (i < 3 * n && e[i] !== k) i += 3
  let r = 0, ev = i < 3 * n
  if (ev) { r = i / 3 + 1; const x = o[k]; if (x === undefined ? e[i + 1] >= REQ : !valueAt(V, props, e, i, x)) return -1 }
  if (X !== null) { const x = X.key(V, X, o, k, ev); if (x < 0) return -1; ev = x === 1 }
  if (!ev && closed) return -1
  return r
}

// After the keys: declared names not met, property counts, required names
// that are not declared, dependencies.
function finish (V, props, e, n, X, o, hits, seen, count, B) {
  if (X !== null && (count < X.lo || count > X.hi)) return false
  if (hits !== n && !(n > 31 ? M().bigAbsent(V, props, e, n, B, o, count, undefined) : absent(V, props, e, n, seen, o, hits))) return false
  return X === null || X.finish(V, X, o)
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
  return pre === undefined && ct === undefined && !uq ? arrSimple(V, g, lo, hi, items) : M().arrGeneral(V, g, lo, hi, uq, pre, items, ct, mic, mac)
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
        case -1: { code = inline(V, items); it = IA; i--; continue }
      }
      if (!leafOk(code, it, x)) return false
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
  if (!int && mn === undefined && mx === undefined && xmn === undefined && xmx === undefined && mo !== undefined) return (d) => Number.isFinite(d) ? multipleOk(d, mo) : !g
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
  // No type, no value: a number check, or a string check, that passes the
  // other kinds.
  if (!typed && vf === null && hasNum !== hasStr) return hasNum ? numCheck(false, false, mn, mx, xmn, xmx, mo) : strCheck(false, lo, hi, pat, fm)
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

// References resolve here, each from the base of the resource it is in: a
// base is known once the resources are indexed, and does not change at run
// time. A reference that does not resolve fails every value, as in the walk.
// A node the index did not record (a pointer into something that is not a
// schema position) has no known base and goes to the second half. Kept apart
// from createVerdict so the index is not retained by the checks.
const SECOND = 1, THROWS = 2, WAIT = 3
// One resolution per reference text and base: a schema often repeats the
// same reference many times.
const resolveOnce = (ref, b, state, memo) => { const k = b + '\n' + ref; let r = memo.get(k); if (r === undefined) memo.set(k, (r = resolveRef(ref, b, state))); return r }
function resolveAll (root, opts, st) {
  const flat = !st.anchors && !st.ids && !opts.schemaMap
  const state = indexSchemas(root, opts.schemaMap, flat)
  const baseOf = (n) => { const b = state.nodeBase.get(n); return b !== undefined ? b : flat ? state.rootBase : undefined }
  const targets = new Map()
  const seen = new Set()
  const memo = new Map()
  const visitTarget = (t) => { if (baseOf(t) === undefined) return false; if (!seen.has(t)) { seen.add(t); if (!visit(t, 0, st)) return false } return true }
  for (let i = 0; i < st.refs.length; i++) {
    const b = baseOf(st.refs[i])
    if (b === undefined) return SECOND
    const r = resolveOnce(st.refs[i].$ref, b, state, memo)
    let t = r.node === undefined || r.node === false ? false : isMap(r.node) ? r.node : true
    if (isMap(t)) {
      if (baseOf(t) !== r.base) return SECOND
      if (!seen.has(t)) { seen.add(t); if (!visit(t, 0, st)) return st.walkThrows ? THROWS : SECOND }
    }
    targets.set(st.refs[i], t)
  }
  let dyn = null
  let done = st.refs.length
  // A reference target can need the parts too.
  if (chunk !== null && moreModule === null && (st.more || st.drefs.length !== 0)) return WAIT
  if (st.drefs.length !== 0) {
    dyn = M().resolveDynamic(st, state, opts, baseOf, visitTarget, targets, done)
    if (typeof dyn === 'number') return dyn
  }
  return { targets, dyn, rootBase: state.rootBase }
}

// The parts loaded when a schema needs them: lib/core/verdict-more.js
// (unevaluated*, $dynamicRef, large objects, rare object and array keywords)
// and the second half, lib/core/verdict-full.js. In Node they are required
// on first use. A browser bundle loads them as a chunk instead: it calls
// _chunked() with a function that imports both; until then createVerdict
// answers PENDING for a schema that needs them, which the scan knows before
// anything is compiled. The require below is not a literal call, so a
// bundler does not pull the parts into the first chunk; an entry that wants
// them in its bundle, still required on first use, hands _parts() functions
// that require them by name (lib/core/feature.js).
let fullModule = null
let moreModule = null
let chunk = null
const req = require
let loadMore = () => req('./verdict-more')
let loadFull = () => req('./verdict-full')
const PENDING = Object.freeze({ pending: true })
const M = () => moreModule || (moreModule = loadMore())
const loaded = () => moreModule !== null && fullModule !== null
function full (root, opts, fmts, mod) {
  if (mod === undefined && chunk !== null && fullModule === null) return pending()
  const V = fmts === null ? PLAIN : new Ctx(null, fmts, false)
  return (mod || fullModule || (fullModule = loadFull())).createFull(root, opts, pattern, (name) => format(V, name))
}
let loading = null
function pending () {
  if (loading === null) loading = chunk().then((ms) => { moreModule = ms[0]; fullModule = ms[1] })
  return PENDING
}

// The scan of a schema, alone: what createVerdict needs before it compiles,
// and with `withFacts` the facts the Validator asks of the schema (null where
// they cannot be told by this walk). createVerdict takes it as its third
// argument, so a caller that needs both walks the schema once.
// An enum or required that is not a list, as every path names it.
const shapeError = (k) => new TypeError('invalid schema: "' + k + '" must be an array')
// The first such keyword anywhere among a schema's subschemas, for a schema
// the scan stopped short of walking.
const SUBS = ['additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'items', 'additionalItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']
const MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items']
function shapeOf (s, depth, seen) {
  if (!isMap(s) || depth > 500 || seen.has(s)) return null
  seen.add(s)
  if (s.enum !== undefined && s.enum !== null && !isArr(s.enum)) return 'enum'
  if (s.required !== undefined && s.required !== null && !isArr(s.required)) return 'required'
  let r = null
  for (const k of SUBS) if (r === null && isMap(s[k])) r = shapeOf(s[k], depth + 1, seen)
  for (const k of MAPS) if (r === null && isMap(s[k])) for (const x of Object.values(s[k])) if (r === null) r = shapeOf(x, depth + 1, seen)
  for (const k of LISTS) if (r === null && isArr(s[k])) for (const x of s[k]) if (r === null) r = shapeOf(x, depth + 1, seen)
  if (r === null && isMap(s.propertyDependencies)) for (const m of Object.values(s.propertyDependencies)) if (r === null && isMap(m)) for (const x of Object.values(m)) if (r === null) r = shapeOf(x, depth + 1, seen)
  return r
}

// Until a reference is met, the scan's lists are this one.
const NONE = Object.freeze([])
// The patterns the walk met, compiled when a verdict is built rather than by
// the walk, which a Validator may use only for its questions.
const pats = (st, src) => (st.pats === NONE ? st.pats = [] : st.pats).push(src)
// False where one does not compile: the core then declines the schema, and
// the walk answers it, throwing for that pattern only where it is reached.
const compile = (st) => { const q = st.pats; if (q === NONE) return true; st.pats = NONE; try { for (let i = 0; i < q.length; i++) pattern(q[i]) } catch { return false } return true }
function scan (root, withFacts) {
  const st = { root, refs: NONE, drefs: NONE, anchors: false, ids: false, more: false, walkThrows: false, falses: false, shape: null, pm: null, pe: null, pats: NONE, seen: null, f: withFacts ? newFacts() : null, facts: null, ok: true, used: false }
  st.ok = isMap(root) && visit(root, 0, st)
  st.facts = st.ok ? st.f : null
  st.f = null
  return st
}
const newFacts = () => ({ errorMessage: false, default: false, format: false, metaRef: false, notFlat: false })

function createVerdict (root, options, prepared) {
  const opts = options || {}
  if (opts.keywords || opts.coerce || opts.discriminator || (opts.numberFormats && keysOf(opts.numberFormats).length > 0)) return null
  if (typeof root === 'boolean') return root ? T : F
  const fmts = opts.formats || null
  const st = prepared && prepared.root === root && !prepared.used ? prepared : scan(root, false)
  st.used = true
  if (st.shape !== null || (!st.ok && (st.shape = shapeOf(root, 0, new Set())) !== null)) throw shapeError(st.shape)
  if (!compile(st)) return null
  if (!st.ok) return st.walkThrows ? null : full(root, opts, fmts)
  if (chunk !== null && moreModule === null && (st.more || st.drefs.length !== 0)) return pending()
  if (st.refs.length === 0 && st.drefs.length === 0) {
    const V = fmts === null ? st.falses ? PLAIN : SURE : new Ctx(null, fmts, false)
    if (!st.falses) V.sure = true
    rootProps = st.pm; rootEntries = st.pe
    try { return build(V, root) } finally { rootProps = rootEntries = null }
  }
  const R = resolveAll(root, opts, st)
  if (st.shape !== null) throw shapeError(st.shape)
  if (!compile(st)) return null
  if (R === THROWS) return null
  if (R === SECOND) return full(root, opts, fmts)
  if (R === WAIT) return pending()
  const targets = R.targets, dyn = R.dyn
  const scope = dyn === null ? null : [R.rootBase]
  const fn = build(new Ctx(targets, fmts, false, dyn, scope), root)
  let guarded = null, gc = null
  return (d) => {
    try { return fn(d) } catch (e) {
      if (!(e instanceof RangeError)) throw e
      if (guarded === null) guarded = build((gc = new Ctx(targets, fmts, true, dyn, scope)), root)
      gc.stack.length = 0
      return guarded(d)
    }
  }
}

// What lib/core/verdict-more.js reads of this file.
module.exports = { createVerdict, PENDING }
// A bundle: how to load the parts, and a promise that settles when they are.
module.exports._chunked = (load) => { chunk = load }
module.exports._parts = (more, full) => { loadMore = more; loadFull = full }
module.exports._loaded = () => loaded() ? Promise.resolve() : loading || Promise.resolve()
module.exports._i = { has, isArr, isMap, keysOf, names, get, ref, Ctx, pattern, bits, O_, valueAt, REQ, propEnum, visit, resolveRef, splitFragment, resolveUri, absent, exactObj, lenOk, sub, inline: (V, s) => { const c = inline(V, s); return [c, IA] }, leafOk, tagOf }
// _second: the second half alone on any schema, for its tests.
module.exports._sequence = sequence
module.exports.scan = scan
module.exports.facts = facts
module.exports.textFacts = textFacts
module.exports._second = (root, opts, mod) => full(root, opts, opts.formats || null, mod)
