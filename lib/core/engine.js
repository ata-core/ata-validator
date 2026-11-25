'use strict'

// Test builds replace this with an object (tests/test_core_engine_mutation.js):
// { forms: false } plans without forms, { shadow: true } runs the walker
// beside every verdict and counts a difference in `faults`. In this file it
// is false, and a bundler drops every branch that reads it; it stays the
// first statement, where esbuild folds it.
const TEST = false

// One engine for verdicts and exact errors (milestone 4b.1). A schema node is
// read once into a plan: a flat list of operations with their operands, in
// the step order of lib/engine-small.js build(), holding no closures. One
// walker, `run`, reads plans in two modes. With no error list it returns at
// the first failure and builds no path. With a list it runs every operation
// and pushes the small engine's errors: the same paths, keywords, messages,
// params and order, the small engine's accidents of order included. Each
// keyword's meaning is written once, here.
//
// The factory has createSmall's interface and declines where it does:
// (schema, { schemaMap, formats, v1, flat }) -> { isValid, validate } | null.
// A node is planned when its parent is, as the small engine builds its
// closures, so a schema error (an `enum` that is not an array, a pattern
// that does not compile) is thrown at the same moment and with the same
// message; a `$ref` target is planned when a value first reaches it. A plan
// whose reading threw keeps no operations, and a value that reaches it
// throws again: it is never read as an empty, always-valid node.
//
// A verdict form: a plan for an object with declared properties whose
// property schemas are leaves (type, bounds, enum, const, pattern, format)
// or forms themselves gets a closure (d) => boolean. The walker calls it for
// a verdict where nothing collects annotations. Its leaf checks call the
// same predicate the walker calls (the table PR), never a copy.
//
// Patterns compile through engine-shared's compilePattern, as in the small
// engine. Nothing here fills defaults or removes properties, and nothing
// reads the environment.

const { indexSchemas, resolveRef, splitFragment, compilePattern } = require('../engine-shared')
const { _deq: eq, duplicatePair } = require('../unique-items')
let collapse = null
let formatTable = null
let off = false


const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const has = Object.hasOwn
const propEnum = Object.prototype.propertyIsEnumerable
const esc = (s) => /[~/]/.test(s) ? s.replace(/~/g, '~0').replace(/\//g, '~1') : s
const err = (keyword, instancePath, schemaPath, params, message) => ({ keyword, instancePath, schemaPath, params, message })

// Type bits as the interpreter has them: an integer also carries `number`,
// a non-finite number carries nothing, an unknown type name matches all.
const O_ = 32
const BIT = { __proto__: null, string: 1, number: 2, integer: 4, boolean: 8, null: 16, object: O_, array: 64 }
const bits = (d) => {
  switch (typeof d) {
    case 'string': return 1
    case 'number': return !isFinite(d) ? 0 : Number.isInteger(d) ? 6 : 2
    case 'boolean': return 8
    case 'object': return d === null ? 16 : Array.isArray(d) ? 64 : O_
    default: return 0
  }
}
const hasPairs = (s, k) => { if (k < 1) return true; for (let i = 0, e = s.length - 2 * k + 1; i < e; i++) if (((s.charCodeAt(i) - 0xd800) >>> 0) < 0x400) { if (s.isWellFormed && s.isWellFormed()) { for (; i < e; i++) if (((s.charCodeAt(i) - 0xd800) >>> 0) < 0x400) { if (--k === 0) return true; i++; e += 2 } } else for (; i < e; i++) if (((s.charCodeAt(i) - 0xd800) >>> 0) < 0x400 && ((s.charCodeAt(i + 1) - 0xdc00) >>> 0) < 0x400) { if (--k === 0) return true; i++; e += 2 } return false } return false }
const cpAtLeast = (s, m) => (s.length + 1) >> 1 >= m || (s.length >= m && !hasPairs(s, Math.floor(s.length - m) + 1))
const cpAtMost = (s, m) => s.length <= m || ((s.length + 1) >> 1 <= m && hasPairs(s, Math.ceil(s.length - m)))
const count = (d) => { let n = 0; for (const k of Object.getOwnPropertyNames(d)) if (propEnum.call(d, k)) n++; return n }
const num = (d) => !Number.isFinite(d)
const str = (d) => typeof d !== 'string'
const arr = (d) => !Array.isArray(d)
const notObj = (d) => bits(d) !== O_

// The leaf predicates, by keyword: true when the value passes or the keyword
// does not apply to it. The walker and the forms both call these.
const PR = {
  type: (d, m) => (bits(d) & m) !== 0,
  enum: (d, x) => d === null || typeof d !== 'object' ? x[0].has(d) : x[1].some((o) => eq(o, d)),
  const: (d, c) => eq(c, d),
  minimum: (d, m) => num(d) || d >= m,
  maximum: (d, m) => num(d) || d <= m,
  exclusiveMinimum: (d, m) => num(d) || d > m,
  exclusiveMaximum: (d, m) => num(d) || d < m,
  multipleOf: (d, m) => { if (num(d)) return true; if (m === 0) return false; const q = d / m; return Number.isInteger(q) || Math.abs(q - Math.round(q)) < 1e-9 },
  minLength: (d, m) => str(d) || cpAtLeast(d, m),
  maxLength: (d, m) => str(d) || cpAtMost(d, m),
  pattern: (d, re) => str(d) || re.test(d),
  format: (d, fn) => str(d) || fn(d),
  minItems: (d, m) => arr(d) || d.length >= m,
  maxItems: (d, m) => arr(d) || d.length <= m,
  minProperties: (d, m) => notObj(d) || count(d) >= m,
  maxProperties: (d, m) => notObj(d) || count(d) <= m,
}

// Annotations: the property names and item indexes a node evaluated, kept
// only where an unevaluated* keyword reads them.
const fresh = () => ({ p: null, i: null })
const NONE = fresh()
const ann = (a) => a !== NONE ? fresh() : NONE
const addP = (a, k) => { if (a !== NONE) (a.p || (a.p = new Set())).add(k) }
const addI = (a, i) => { if (a !== NONE) (a.i || (a.i = new Set())).add(i) }
const merge = (a, b) => { if (a !== NONE) { for (const x of b.p || []) addP(a, x); for (const x of b.i || []) addI(a, x) } }
// A subschema applied in place: what it evaluated counts for this node when
// it passes.
const at = (P, d, E, ip, sp, sc, st, a, b) => { const sub = ann(a); if (!run(P, d, E, ip, sp, sc, st, sub, b)) return false; merge(a, sub); return true }

// A plan: o, the operations (null until read, and for good if reading threw);
// v, the verdict form or undefined; b, the base a nested $id fixes; t, whether
// the node has $ref or $dynamicRef (the cycle guard); u, whether it reads
// annotations itself.
const plan = (o, b, t, u) => ({ o, v: undefined, b, t, u })
const TRUE = plan([], undefined, false, false)
const FALSE = plan([[18]], undefined, false, false)

// Operation codes. 0 is a leaf: [0, predicate, operand, keyword, params, message].
// 1 $ref, 2 $dynamicRef, 3 uniqueItems, 4 prefixItems and items, 5 contains,
// 6 required, 7 dependentRequired, 8 propertyNames, 9 the key loop
// (properties, patternProperties, additionalProperties), 10 dependentSchemas,
// 11 propertyDependencies, 12 allOf, 13 anyOf and oneOf, 14 not, 15 if,
// 16 unevaluatedProperties, 17 unevaluatedItems, 18 the false schema.

function run (P, d, E, ip, sp, sc, st, k, b) {
  if (E === null && k === NONE && P.v !== undefined && !(TEST && off)) return P.v(d)
  const o = P.o
  const base = P.b !== undefined ? P.b : b
  if (P.t) {
    for (let i = st.length - 2; i >= 0; i -= 2) if (st[i] === P && st[i + 1] === d) return true
    st.push(P, d)
  }
  let pushed = false
  if (sc[sc.length - 1] !== base) { sc.push(base); pushed = true }
  const a = k !== NONE || P.u ? fresh() : NONE
  let ok = true
  for (let n = 0; n < o.length && (ok || E !== null); n++) {
    const op = o[n]
    switch (op[0]) {
      case 0:
        if (!op[1](d, op[2])) { ok = false; if (E) E.push(err(op[3], ip, sp + '/' + op[3], { ...op[4] }, op[5])) }
        break
      case 1: case 2: {
        // $ref and $dynamicRef: the target runs at this node's paths.
        const X = op[3]; const dyn = op[0] === 2; const kw = dyn ? '$dynamicRef' : '$ref'
        let r = op[2].get(base)
        if (r === undefined) {
          const q = resolveRef(op[1], base, X.st)
          if (dyn) { const f = splitFragment(op[1])[1]; r = [q.node, q.base, f, !!f && f[0] !== '/'] } else r = q.node === undefined ? null : [X.get(q.node), q.base]
          op[2].set(base, r)
        }
        let node = r && r[0]; let rb = r && r[1]
        if (dyn) {
          if (r[3]) {
            // 2020-12 consults the dynamic scope only when the initial target
            // carries the anchor itself (bookending); v1 always does.
            const m0 = X.st.dynamicAnchors.get(rb)
            if (!X.bk || (node !== undefined && m0 !== undefined && m0.get(r[2]) === node)) {
              for (const x of sc) { const m = X.st.dynamicAnchors.get(x); if (m && m.has(r[2])) { node = m.get(r[2]); rb = x; break } }
            }
          }
          if (node !== undefined) node = X.get(node)
        }
        if (r === null || node === undefined) { ok = false; if (E) E.push(err(kw, ip, sp + '/' + kw, { ref: op[1] }, `cannot resolve ${kw} ${op[1]}`)) } else if (!at(node, d, E, ip, sp, sc, st, a, rb)) ok = false
        break
      }
      case 3:
        if (Array.isArray(d)) {
          const pr = duplicatePair(d)
          if (pr !== null) { ok = false; if (E) E.push(err('uniqueItems', ip, sp + '/uniqueItems', { i: pr[0], j: pr[1] }, `must NOT have duplicate items (items ## ${pr[1]} and ${pr[0]} are identical)`)) }
        }
        break
      case 4:
        if (Array.isArray(d)) {
          const pre = op[1]; const np = pre ? pre.length : 0
          for (let i = 0; i < d.length; i++) {
            const c = i < np ? pre[i] : op[2]
            if (c === null) break
            if (!run(c, d[i], E, E && ip + '/' + i, E && sp + (i < np ? '/prefixItems/' + i : '/items'), sc, st, NONE, base)) { ok = false; if (!E) break }
            addI(a, i)
          }
        }
        break
      case 5:
        if (Array.isArray(d)) {
          const mi = op[2]; const mx = op[3]; const m = []
          for (let i = 0; i < d.length; i++) if (run(op[1], d[i], null, '', '', sc, st, NONE, base)) m.push(i)
          if (m.length < mi) { ok = false; if (E) E.push(err('contains', ip, sp + '/contains', { minContains: mi }, `must contain at least ${mi} valid item(s)`)) }
          if (mx !== undefined && m.length > mx) { ok = false; if (E) E.push(err('contains', ip, sp + '/contains', { minContains: mi, maxContains: mx }, `must NOT contain more than ${mx} valid item(s)`)) }
          for (const i of m) addI(a, i)
        }
        break
      case 6:
        // A required name that is also a declared property and is present
        // with the value undefined: collecting errors, reported here; for a
        // verdict, failed by the key loop, as the small engine has it.
        if (!notObj(d)) for (const q of op[1]) {
          if (miss(d, q, E !== null || op[2] === null || !op[2].has(q))) { ok = false; if (!E) break; E.push(err('required', ip, sp + '/required', { missingProperty: q }, `must have required property '${q}'`)) }
        }
        break
      case 7:
        if (!notObj(d)) {
          L: for (const [q, list] of op[1]) if (has(d, q)) for (const x of list) if (!has(d, x)) { ok = false; if (!E) break L; E.push(err('required', ip, sp + '/dependentRequired', { missingProperty: x }, `must have required property '${x}'`)) }
        }
        break
      case 8:
        if (!notObj(d)) for (const q of Object.getOwnPropertyNames(d)) if (propEnum.call(d, q) && !run(op[1], q, E, ip, E && sp + '/propertyNames', sc, st, NONE, base)) { ok = false; if (!E) break }
        break
      case 9:
        if (!notObj(d)) {
          const props = op[1]; const pats = op[2]; const ap = op[3]
          K: for (const q of Object.getOwnPropertyNames(d)) {
            let ev = false
            const pr = props !== null ? props.get(q) : undefined
            const seen = (pr !== undefined && pats === null && ap === undefined) || propEnum.call(d, q)
            if (pr !== undefined) {
              const v = d[q]
              if (v !== undefined) { if (!run(pr[0], v, E, E && ip + '/' + pr[1], E && sp + '/properties/' + pr[1], sc, st, NONE, base)) { ok = false; if (!E) break } } else if (op[5] !== null && op[5].has(q)) { ok = false; if (!E) break }
              ev = true
            }
            if (pats !== null && seen) {
              for (const p of pats) {
                if (p[0].test(q)) {
                  if (!run(p[1], d[q], E, E && ip + '/' + esc(q), E && sp + '/patternProperties/' + p[2], sc, st, NONE, base)) { ok = false; if (!E) break K }
                  ev = true
                }
              }
            }
            if (!ev && seen && ap !== undefined) {
              if (ap === false) { ok = false; if (!E) break; E.push(err('additionalProperties', ip, sp + '/additionalProperties', { additionalProperty: q }, 'must NOT have additional properties')) } else if (!run(op[4], d[q], E, E && ip + '/' + esc(q), E && sp + '/additionalProperties', sc, st, NONE, base)) { ok = false; if (!E) break }
              ev = true
            }
            if (ev) addP(a, q)
          }
        }
        break
      case 10: case 11: case 12: {
        // In place: dependentSchemas, propertyDependencies, allOf.
        if (op[0] !== 12 && notObj(d)) break
        for (let i = 0; i < op[1].length; i++) {
          let x = op[1][i]; let p = '/allOf/' + i
          if (op[0] !== 12) {
            if (!has(d, x[0])) continue
            if (op[0] === 11) {
              if (typeof d[x[0]] !== 'string' || (x = x[1].get(d[x[0]])) === undefined) continue
              p = x[1]; x = x[0]
            } else { p = x[2]; x = x[1] }
          }
          if (!at(x, d, E, ip, E && sp + p, sc, st, a, base)) { ok = false; if (!E) break }
        }
        break
      }
      case 13: {
        const fs = op[1]; const kw = op[3]; const one = kw === 'oneOf'
        let n = 0; let win = null
        for (let i = 0; i < fs.length; i++) {
          const sub = ann(a)
          if (run(fs[i], d, null, '', '', sc, st, sub, base)) {
            n++
            if (one) win = sub; else if (a !== NONE) merge(a, sub); else break
          }
        }
        if (one ? n === 1 : n > 0) { if (one) merge(a, win) } else {
          ok = false
          if (E) {
            const br = []
            for (let i = 0; i < fs.length; i++) { const x = []; br.push({ valid: run(fs[i], d, x, ip, sp + '/' + kw + '/' + i, sc, st, NONE, base), errors: x, title: op[2][i] }) }
            const c = (collapse || (collapse = require('../branch-collapse')._collapse))(kw, br, ip, sp + '/' + kw, null)
            if (c !== null) E.push(c)
          }
        }
        break
      }
      case 14:
        if (run(op[1], d, null, '', '', sc, st, NONE, base)) { ok = false; if (E) E.push(err('not', ip, sp + '/not', {}, 'must NOT be valid')) }
        break
      case 15: {
        let c = op[3]; let p = '/else'
        if (at(op[1], d, null, '', '', sc, st, a, base)) { c = op[2]; p = '/then' }
        if (c !== null && !at(c, d, E, ip, E && sp + p, sc, st, a, base)) ok = false
        break
      }
      case 16:
        if (!notObj(d)) {
          for (const q of Object.keys(d)) {
            if (a.p && a.p.has(q)) continue
            if (op[1] === false) { ok = false; if (!E) break; E.push(err('unevaluatedProperties', ip, sp + '/unevaluatedProperties', { unevaluatedProperty: q }, 'must NOT have unevaluated properties')) } else if (!run(op[2], d[q], E, E && ip + '/' + esc(q), E && sp + '/unevaluatedProperties', sc, st, NONE, base)) { ok = false; if (!E) break }
            addP(a, q)
          }
        }
        break
      case 17:
        if (Array.isArray(d)) {
          for (let i = 0; i < d.length; i++) {
            if (a.i && a.i.has(i)) continue
            if (op[1] === false) { ok = false; if (E) E.push(err('unevaluatedItems', ip, sp + '/unevaluatedItems', { limit: i }, 'must NOT have more than ' + i + ' items')); break }
            if (!run(op[2], d[i], E, E && ip + '/' + i, E && sp + '/unevaluatedItems', sc, st, NONE, base)) { ok = false; if (!E) break }
            addI(a, i)
          }
        }
        break
      default:
        ok = false
        if (E) E.push(err('not', ip, sp, {}, 'boolean schema is false'))
    }
  }
  if (pushed) sc.pop()
  if (P.t) st.length -= 2
  if (ok && a !== NONE) merge(k, a)
  return ok
}

// Whether a required name is missing; `strict` counts an own property whose
// value is undefined as missing.
const miss = (d, q, strict) => !has(d, q) || (strict && d[q] === undefined)

// The form for an object with declared properties, made from its plan when
// the plan holds nothing but leaves, required and a key loop of declared
// properties (closed or open), and each property's plan is a leaf or has a
// form. Undefined otherwise.
const leafOk = (c, v) => { for (const op of c.o) if (!op[1](v, op[2])) return false; return true }
function form (P) {
  if (P.t || P.u) return
  const L = []; let R = null; let K = null; let closed = false
  for (const op of P.o) {
    if (op[0] === 0) L.push(op)
    else if (op[0] === 6) R = op[1]
    else if (op[0] === 9 && op[1] !== null && op[2] === null && (op[3] === undefined || op[3] === false)) {
      for (const [, [c]] of op[1]) if (c.v === undefined && (c.o === null || c.o.some((x) => x[0] !== 0))) return
      K = op[1]; closed = op[3] === false
    } else return
  }
  if (K === null) return
  const ks = [...K]
  P.v = (d) => {
    for (const op of L) if (!op[1](d, op[2])) return false
    if (notObj(d)) return true
    if (R !== null) for (const q of R) if (miss(d, q, true)) return false
    for (const [q, [c]] of ks) {
      if (has(d, q)) { const v = d[q]; if (v !== undefined && !(c.v !== undefined ? c.v(v) : leafOk(c, v))) return false }
    }
    if (closed) for (const q of Object.keys(d)) if (!K.has(q)) return false
    return true
  }
}

function createEngine (root, options) {
  const opts = options || {}
  if (opts.keywords || opts.coerce || opts.discriminator || (opts.numberFormats && Object.keys(opts.numberFormats).length > 0)) return null
  const fmts = opts.formats || null
  const state = indexSchemas(root, opts.schemaMap, opts.flat === true)
  const patterns = new Map()
  const pattern = (src) => { let re = patterns.get(src); if (re === undefined) patterns.set(src, (re = compilePattern(src))); return re }
  const cache = new Map()
  const X = { st: state, bk: !opts.v1, get }

  function get (s) {
    if (s === false) return FALSE
    if (!isObj(s)) return TRUE
    let P = cache.get(s)
    if (P === undefined) {
      cache.set(s, (P = plan(null, state.nodeBase.get(s), typeof s.$ref === 'string' || typeof s.$dynamicRef === 'string', s.unevaluatedProperties !== undefined || s.unevaluatedItems !== undefined)))
      read(s, P)
    }
    return P
  }

  // A node's operations, in the small engine's step order, its children
  // planned in the order the small engine builds them.
  function read (s, P) {
    const o = []
    const g = (x) => x !== undefined ? get(x) : null
    const leaf = (kw, x, params, msg) => o.push([0, PR[kw], x, kw, params, msg])
    if (typeof s.$ref === 'string') o.push([1, s.$ref, new Map(), X])
    if (typeof s.$dynamicRef === 'string') o.push([2, s.$dynamicRef, new Map(), X])
    // `enum` and `required` must be arrays: the schema error the 1.x engines
    // give. null reads as absent there, so it does here.
    for (const k of ['enum', 'required']) if (s[k] != null && !Array.isArray(s[k])) throw new TypeError(`invalid schema: "${k}" must be an array`)
    if (s.type !== undefined) {
      const ts = Array.isArray(s.type) ? s.type : [s.type]
      let mask = 0; for (const t of ts) mask |= BIT[t] === undefined ? 127 : BIT[t]
      leaf('type', mask, { type: s.type }, 'must be ' + ts.join(', '))
    }
    if (s.enum != null) {
      const prims = new Set(); const objs = []
      for (const v of s.enum) { if (v !== null && typeof v === 'object') objs.push(v); else if (!(typeof v === 'number' && v !== v)) prims.add(v) }
      leaf('enum', [prims, objs], { allowedValues: s.enum }, 'must be equal to one of the allowed values')
    }
    if (s.const !== undefined) leaf('const', s.const, { allowedValue: s.const }, 'must be equal to constant')
    for (const [k, c] of [['minimum', '>='], ['maximum', '<='], ['exclusiveMinimum', '>'], ['exclusiveMaximum', '<']]) {
      const m = s[k]; if (typeof m === 'number') leaf(k, m, { comparison: c, limit: m }, `must be ${c} ${m}`)
    }
    if (typeof s.multipleOf === 'number') leaf('multipleOf', s.multipleOf, { multipleOf: s.multipleOf }, `must be multiple of ${s.multipleOf}`)
    const bound = (k, w, u) => { const m = s[k]; if (m !== undefined) leaf(k, m, { limit: m }, `must NOT have ${w} than ${m} ${u}`) }
    bound('minLength', 'fewer', 'characters')
    bound('maxLength', 'more', 'characters')
    if (s.pattern !== undefined) leaf('pattern', pattern(s.pattern), { pattern: s.pattern }, `must match pattern "${s.pattern}"`)
    if (typeof s.format === 'string') {
      // Own properties only, as the interpreter reads them.
      const name = s.format; const table = formatTable || (formatTable = require('../formats').formatChecks())
      const fn = fmts !== null && has(fmts, name) && typeof fmts[name] === 'function' ? fmts[name] : has(table, name) && typeof table[name] === 'function' ? table[name] : null
      if (fn !== null) leaf('format', fn, { format: name }, `must match format "${name}"`)
    }
    bound('minItems', 'fewer', 'items')
    bound('maxItems', 'more', 'items')
    if (s.uniqueItems === true) o.push([3])
    const pre = Array.isArray(s.prefixItems) ? s.prefixItems.map(get) : null
    const items = g(s.items)
    if (pre || items) o.push([4, pre, items])
    if (s.contains !== undefined) o.push([5, get(s.contains), s.minContains !== undefined ? s.minContains : 1, s.maxContains])
    const props = isObj(s.properties) ? new Map(Object.keys(s.properties).map((k) => [k, [get(s.properties[k]), esc(k)]])) : null
    const req = Array.isArray(s.required) ? s.required : null
    // The required names that are also declared properties.
    const both = req && props ? new Set(req.filter((k) => props.has(k))) : null
    if (req) o.push([6, req, both])
    bound('minProperties', 'fewer', 'properties')
    bound('maxProperties', 'more', 'properties')
    if (isObj(s.dependentRequired)) o.push([7, Object.entries(s.dependentRequired)])
    if (s.propertyNames !== undefined) o.push([8, get(s.propertyNames)])
    const pats = isObj(s.patternProperties) ? Object.keys(s.patternProperties).map((src) => [pattern(src), get(s.patternProperties[src]), esc(src)]) : null
    const ap = s.additionalProperties
    const apf = g(ap)
    if (props || pats || ap !== undefined) o.push([9, props, pats, ap, apf, both])
    if (isObj(s.dependentSchemas)) o.push([10, Object.entries(s.dependentSchemas).map(([k, x]) => [k, get(x), '/dependentSchemas/' + esc(k)])])
    if (isObj(s.propertyDependencies)) {
      o.push([11, Object.entries(s.propertyDependencies).filter(([, c]) => isObj(c)).map(([k, c]) => [k, new Map(Object.keys(c).map((v) => [v, [get(c[v]), '/propertyDependencies/' + esc(k) + '/' + esc(v)]]))])])
    }
    if (Array.isArray(s.allOf)) o.push([12, s.allOf.map(get)])
    for (const kw of ['anyOf', 'oneOf']) if (Array.isArray(s[kw])) o.push([13, s[kw].map(get), s[kw].map((x) => isObj(x) && typeof x.title === 'string' ? x.title : ''), kw])
    if (s.not !== undefined) o.push([14, get(s.not)])
    if (s.if !== undefined) o.push([15, get(s.if), g(s.then), g(s.else)])
    const uP = s.unevaluatedProperties; const uI = s.unevaluatedItems
    const uPf = g(uP); const uIf = g(uI)
    if (uP !== undefined) o.push([16, uP, uPf])
    if (uI !== undefined) o.push([17, uI, uIf])
    P.o = o
    if (!(TEST && TEST.forms === false)) form(P)
  }

  return new Engine(get(root), state.rootBase)
}

// One object per validator, its methods shared. validate's first call is the
// walker's, collecting errors: one walk has the verdict and the errors. Its
// answer decides what validate becomes, as the object's own property, so
// later calls pay no frame for the choice: after a failure, the walker for
// good; after a pass, the verdict first and the walker for a value that
// fails, until failures pass a quarter of at least 8 calls.
class Engine {
  constructor (r, top) { this.r = r; this.top = top; this.n = 1; this.f = 0 }

  isValid (d) {
    if (TEST && TEST.shadow) {
      const x = run(this.r, d, null, '', '#', [this.top], [], NONE, this.top)
      off = true
      let y
      try { y = run(this.r, d, null, '', '#', [this.top], [], NONE, this.top) } finally { off = false }
      if (x !== y) { TEST.faults = (TEST.faults || 0) + 1; throw new Error('ata 4b shadow: the form says ' + x + ', the walker ' + y) }
      return x
    }
    return run(this.r, d, null, '', '#', [this.top], [], NONE, this.top)
  }

  walk (d) {
    const E = []
    return run(this.r, d, E, '', '#', [this.top], [], NONE, this.top) ? { valid: true, data: d, errors: [] } : { valid: false, errors: E }
  }

  validate (d) {
    const r = this.walk(d)
    this.validate = r.valid ? this.fast : this.walk
    return r
  }

  fast (d) {
    this.n++
    if (this.isValid(d)) return { valid: true, data: d, errors: [] }
    const r = this.walk(d)
    if (++this.f * 4 > this.n && this.n >= 8) this.validate = this.walk
    if (r.valid) {
      // The verdict failed a value the walker passes. It stays rejected,
      // with one generic error, never accepted.
      if (TEST) TEST.generic = (TEST.generic || 0) + 1
      return { valid: false, errors: [err('validation', '', '', {}, 'schema validation failed')] }
    }
    return r
  }
}

module.exports = { createEngine, createSmall: createEngine }
if (TEST) module.exports._t = { TEST, PR }
