'use strict'

// The small engine: a schema as a tree of closures, built in one pass. It is
// what a page's first load carries (lib/interpreter.browser.js), a third of
// the interpreter's size, and it answers as the interpreter's walk does: the
// same verdicts and the same error list, in the same order
// (tests/test_engine_small.js holds it to that on the official suite). It
// resolves references and compiles patterns with the interpreter's own code
// (lib/engine-shared.js) and shares its equality, duplicate search and branch
// collapse. It is about as fast as the walk; the closure tree of
// lib/plan-compiler.js and generated code are faster, and take over a schema
// that is used often, as they do from the walk.
//
// Not here: custom keywords, coercion where each type is checked, the
// discriminator and number formats. createSmall returns null for those and
// the caller uses the interpreter.

const { indexSchemas, resolveRef, splitFragment, resolveUri, compilePattern } = require('./engine-shared')
const { _deq: eq, duplicatePair } = require('./unique-items')
let _collapse = null
const collapse = (kw, br, pp, sp, o) => (_collapse || (_collapse = require('./branch-collapse')._collapse))(kw, br, pp, sp, o)
let formatTable = null

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const has = Object.hasOwn
const propEnum = Object.prototype.propertyIsEnumerable
const esc = (s) => /[~/]/.test(s) ? s.replace(/~/g, '~0').replace(/\//g, '~1') : s
const err = (keyword, instancePath, schemaPath, params, message) => ({ keyword, instancePath, schemaPath, params, message })

// Type bits as the interpreter has them: an integer also carries `number`,
// a non-finite number carries nothing, an unknown type name matches all.
const S_ = 1, N_ = 2, I_ = 4, B_ = 8, Z_ = 16, O_ = 32, A_ = 64
const BIT = { string: S_, number: N_, integer: I_, boolean: B_, null: Z_, object: O_, array: A_ }
const bits = (d) => {
  switch (typeof d) {
    case 'string': return S_
    case 'number': return !isFinite(d) ? 0 : Number.isInteger(d) ? N_ | I_ : N_
    case 'boolean': return B_
    case 'object': return d === null ? Z_ : Array.isArray(d) ? A_ : O_
    default: return 0
  }
}
const cpLen = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { if (((s.charCodeAt(i) - 0xd800) >>> 0) < 0x400 && i + 1 < s.length) i++; n++; } return n; }
const cpAtLeast = (s, m) => s.length >= 2 * m || (s.length >= m && cpLen(s) >= m)
const cpAtMost = (s, m) => s.length <= m || (s.length <= 2 * m + 1 && cpLen(s) <= m)
const multipleOk = (d, m) => { if (m === 0) return false; const q = d / m; return Number.isInteger(q) || Math.abs(q - Math.round(q)) < 1e-9; }

// options: schemaMap, formats (the caller's), v1, flat, as the interpreter
// takes them. Null when the options ask for what this engine does not do.
function createSmall(root, options) {
  const opts = options || {}
  if (opts.keywords || opts.coerce || opts.discriminator || (opts.numberFormats && Object.keys(opts.numberFormats).length > 0)) return null
  const fmts = opts.formats || null
  const bookending = !opts.v1
  const state = indexSchemas(root, opts.schemaMap, opts.flat === true)
  const top = state.rootBase
  // Whether any node built so far has unevaluatedProperties or
  // unevaluatedItems: until one does, nothing reads annotations and none are
  // collected. A node is built before it first runs, so the flag is set
  // before anything under such a node is asked for them.
  let track = false
  const patterns = new Map()
  const pattern = (src) => { let re = patterns.get(src); if (re === undefined) patterns.set(src, (re = compilePattern(src))); return re; }

  const merge = (a, b) => {
    if (b.p) { if (!a.p) a.p = new Set(); for (const x of b.p) a.p.add(x) }
    if (b.i) { if (!a.i) a.i = new Set(); for (const x of b.i) a.i.add(x) }
  }
  const NONE = { p: null, i: null }
  const ann = () => track ? { p: null, i: null } : NONE

  const cache = new Map()
  // node -> (d, E, ip, sp, scope, stack, sink) => boolean. E: the error list,
  // or null for a verdict; paths are built only when E is a list.
  function get (s) {
    if (s === true) return () => true
    if (s === false) return (d, E, ip, sp) => { if (E) E.push(err('not', ip, sp, {}, 'boolean schema is false')); return false }
    if (!isObj(s)) return () => true
    let f = cache.get(s)
    if (f) return f
    let impl
    f = (d, E, ip, sp, sc, st, sink, b) => impl(d, E, ip, sp, sc, st, sink, b)
    cache.set(s, f)
    impl = build(s)
    return f
  }

  function build (s) {
    const fixed = state.nodeBase.get(s)
    if (s.unevaluatedProperties !== undefined || s.unevaluatedItems !== undefined) track = true
    const steps = []
    const step = (fn) => steps.push(fn)

    // $ref and $dynamicRef: the target runs at this node's paths.
    const tracked = typeof s.$ref === 'string' || typeof s.$dynamicRef === 'string'
    if (typeof s.$ref === 'string') {
      const ref = s.$ref; const byBase = new Map()
      step((d, E, ip, sp, sc, st, a, b) => {
        let t = byBase.get(b)
        if (t === undefined) { const r = resolveRef(ref, b, state); t = r.node === undefined ? null : { f: get(r.node), base: r.base }; byBase.set(b, t) }
        if (t === null) { if (E) E.push(err('$ref', ip, sp + '/$ref', { ref }, `cannot resolve $ref ${ref}`)); return false }
        const sub = ann(); if (!t.f(d, E, ip, sp, sc, st, sub, t.base)) return false
        if (a !== NONE) merge(a, sub); return true
      })
    }
    if (typeof s.$dynamicRef === 'string') {
      const ref = s.$dynamicRef; const byBase = new Map()
      step((d, E, ip, sp, sc, st, a, b) => {
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
        if (node === undefined) { if (E) E.push(err('$dynamicRef', ip, sp + '/$dynamicRef', { ref }, `cannot resolve $dynamicRef ${ref}`)); return false }
        const sub = ann(); if (!get(node)(d, E, ip, sp, sc, st, sub, rb)) return false
        if (a !== NONE) merge(a, sub); return true
      })
    }

    // type, enum, const
    if (s.type !== undefined) {
      const ts = Array.isArray(s.type) ? s.type : [s.type]
      let mask = 0; for (const t of ts) mask |= BIT[t] === undefined ? 127 : BIT[t]
      const raw = s.type; const msg = 'must be ' + ts.join(', ')
      step((d, E, ip, sp) => { if (bits(d) & mask) return true; if (E) E.push(err('type', ip, sp + '/type', { type: raw }, msg)); return false })
    }
    if (s.enum !== undefined) {
      const vals = s.enum; const prims = new Set(); const objs = []
      if (Array.isArray(vals)) for (const v of vals) { if (v !== null && typeof v === 'object') objs.push(v); else if (!(typeof v === 'number' && v !== v)) prims.add(v) }
      step((d, E, ip, sp) => {
        if (d === null || typeof d !== 'object' ? prims.has(d) : objs.some((o) => eq(o, d))) return true
        if (E) E.push(err('enum', ip, sp + '/enum', { allowedValues: vals }, 'must be equal to one of the allowed values')); return false
      })
    }
    if (s.const !== undefined) {
      const c = s.const
      step((d, E, ip, sp) => { if (eq(c, d)) return true; if (E) E.push(err('const', ip, sp + '/const', { allowedValue: c }, 'must be equal to constant')); return false })
    }

    // numbers (finite only)
    const num = (k, test, params, msg) => { const m = s[k]; if (typeof m !== 'number') return; step((d, E, ip, sp) => { if (!Number.isFinite(d) || test(d, m)) return true; if (E) E.push(err(k, ip, sp + '/' + k, params(m), msg(m))); return false }) }
    num('minimum', (d, m) => d >= m, (m) => ({ comparison: '>=', limit: m }), (m) => `must be >= ${m}`)
    num('maximum', (d, m) => d <= m, (m) => ({ comparison: '<=', limit: m }), (m) => `must be <= ${m}`)
    num('exclusiveMinimum', (d, m) => d > m, (m) => ({ comparison: '>', limit: m }), (m) => `must be > ${m}`)
    num('exclusiveMaximum', (d, m) => d < m, (m) => ({ comparison: '<', limit: m }), (m) => `must be < ${m}`)
    num('multipleOf', multipleOk, (m) => ({ multipleOf: m }), (m) => `must be multiple of ${m}`)

    // strings
    const str = (k, test, params, msg) => { const m = s[k]; if (m === undefined) return; step((d, E, ip, sp) => { if (typeof d !== 'string' || test(d, m)) return true; if (E) E.push(err(k, ip, sp + '/' + k, params(m), msg(m))); return false }) }
    str('minLength', cpAtLeast, (m) => ({ limit: m }), (m) => `must NOT have fewer than ${m} characters`)
    str('maxLength', cpAtMost, (m) => ({ limit: m }), (m) => `must NOT have more than ${m} characters`)
    if (s.pattern !== undefined) {
      const src = s.pattern; const re = pattern(src)
      step((d, E, ip, sp) => { if (typeof d !== 'string' || re.test(d)) return true; if (E) E.push(err('pattern', ip, sp + '/pattern', { pattern: src }, `must match pattern "${src}"`)); return false })
    }
    if (typeof s.format === 'string') {
      // Own properties only, as the interpreter reads them.
      const name = s.format; const table = formatTable || (formatTable = require('./formats').formatChecks())
      const fn = fmts !== null && has(fmts, name) && typeof fmts[name] === 'function' ? fmts[name] : has(table, name) && typeof table[name] === 'function' ? table[name] : null
      if (fn !== null) step((d, E, ip, sp) => { if (typeof d !== 'string' || fn(d)) return true; if (E) E.push(err('format', ip, sp + '/format', { format: name }, `must match format "${name}"`)); return false })
    }

    // arrays
    if (s.minItems !== undefined) { const m = s.minItems; step((d, E, ip, sp) => { if (!Array.isArray(d) || d.length >= m) return true; if (E) E.push(err('minItems', ip, sp + '/minItems', { limit: m }, `must NOT have fewer than ${m} items`)); return false }) }
    if (s.maxItems !== undefined) { const m = s.maxItems; step((d, E, ip, sp) => { if (!Array.isArray(d) || d.length <= m) return true; if (E) E.push(err('maxItems', ip, sp + '/maxItems', { limit: m }, `must NOT have more than ${m} items`)); return false }) }
    if (s.uniqueItems === true) {
      step((d, E, ip, sp) => {
        if (!Array.isArray(d)) return true
        const pair = duplicatePair(d); if (pair === null) return true
        const [i, j] = pair
        if (E) E.push(err('uniqueItems', ip, sp + '/uniqueItems', { i, j }, `must NOT have duplicate items (items ## ${j} and ${i} are identical)`)); return false
      })
    }
    const prefix = Array.isArray(s.prefixItems) ? s.prefixItems.map(get) : null
    const items = s.items !== undefined ? get(s.items) : null
    if (prefix || items) {
      step((d, E, ip, sp, sc, st, a, b) => {
        if (!Array.isArray(d)) return true
        let ok = true; const n = prefix ? Math.min(prefix.length, d.length) : 0
        for (let i = 0; i < n; i++) {
          if (!prefix[i](d[i], E, E ? ip + '/' + i : '', E ? sp + '/prefixItems/' + i : '', sc, st, NONE, b)) { ok = false; if (!E) return false }
          if (a !== NONE) (a.i || (a.i = new Set())).add(i)
        }
        if (items) for (let i = prefix ? prefix.length : 0; i < d.length; i++) {
          if (!items(d[i], E, E ? ip + '/' + i : '', E ? sp + '/items' : '', sc, st, NONE, b)) { ok = false; if (!E) return false }
          if (a !== NONE) (a.i || (a.i = new Set())).add(i)
        }
        return ok
      })
    }
    if (s.contains !== undefined) {
      const c = get(s.contains); const minC = s.minContains !== undefined ? s.minContains : 1; const maxC = s.maxContains
      step((d, E, ip, sp, sc, st, a, b) => {
        if (!Array.isArray(d)) return true
        const matched = []
        for (let i = 0; i < d.length; i++) if (c(d[i], null, '', '', sc, st, NONE, b)) matched.push(i)
        let ok = true
        if (matched.length < minC) { ok = false; if (E) E.push(err('contains', ip, sp + '/contains', { minContains: minC }, `must contain at least ${minC} valid item(s)`)) }
        if (maxC !== undefined && matched.length > maxC) { ok = false; if (E) E.push(err('contains', ip, sp + '/contains', { minContains: minC, maxContains: maxC }, `must NOT contain more than ${maxC} valid item(s)`)) }
        if (a !== NONE && matched.length) { if (!a.i) a.i = new Set(); for (const i of matched) a.i.add(i) }
        return ok
      })
    }

    // objects
    const props = isObj(s.properties) ? new Map(Object.keys(s.properties).map((k) => [k, { f: get(s.properties[k]), ek: esc(k) }])) : null
    const req = Array.isArray(s.required) ? s.required : null
    const reqUndef = req && req.map((k) => props === null || !props.has(k))
    const reqInProps = req && props ? req.filter((k, i) => props.has(k) && req.indexOf(k) === i) : null
    if (req) {
      step((d, E, ip, sp) => {
        if (bits(d) !== O_) return true
        let ok = true
        for (let i = 0; i < req.length; i++) {
          const k = req[i]
          if (!has(d, k) || (reqUndef[i] && d[k] === undefined)) { ok = false; if (!E) return false; E.push(err('required', ip, sp + '/required', { missingProperty: k }, `must have required property '${k}'`)) }
        }
        return ok
      })
    }
    const count = (d) => { let n = 0; for (const k of Object.getOwnPropertyNames(d)) if (propEnum.call(d, k)) n++; return n }
    if (s.minProperties !== undefined) { const m = s.minProperties; step((d, E, ip, sp) => { if (bits(d) !== O_ || count(d) >= m) return true; if (E) E.push(err('minProperties', ip, sp + '/minProperties', { limit: m }, `must NOT have fewer than ${m} properties`)); return false }) }
    if (s.maxProperties !== undefined) { const m = s.maxProperties; step((d, E, ip, sp) => { if (bits(d) !== O_ || count(d) <= m) return true; if (E) E.push(err('maxProperties', ip, sp + '/maxProperties', { limit: m }, `must NOT have more than ${m} properties`)); return false }) }
    if (isObj(s.dependentRequired)) {
      const deps = Object.entries(s.dependentRequired)
      step((d, E, ip, sp) => {
        if (bits(d) !== O_) return true
        let ok = true
        for (const [k, list] of deps) if (has(d, k)) for (const x of list) if (!has(d, x)) { ok = false; if (!E) return false; E.push(err('required', ip, sp + '/dependentRequired', { missingProperty: x }, `must have required property '${x}'`)) }
        return ok
      })
    }
    if (s.propertyNames !== undefined) {
      const pn = get(s.propertyNames)
      step((d, E, ip, sp, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        let ok = true
        for (const k of Object.getOwnPropertyNames(d)) if (propEnum.call(d, k) && !pn(k, E, ip, E ? sp + '/propertyNames' : '', sc, st, NONE, b)) { ok = false; if (!E) return false }
        return ok
      })
    }
    const pats = isObj(s.patternProperties) ? Object.keys(s.patternProperties).map((src) => ({ src, es: esc(src), re: pattern(src), f: get(s.patternProperties[src]) })) : null
    const ap = s.additionalProperties
    const apf = ap !== undefined && ap !== false ? get(ap) : null
    if (props || pats || ap !== undefined) {
      step((d, E, ip, sp, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        let ok = true
        for (const key of Object.getOwnPropertyNames(d)) {
          let evaluated = false
          const prop = props !== null ? props.get(key) : undefined
          const seen = (prop !== undefined && pats === null && ap === undefined) || propEnum.call(d, key)
          if (prop !== undefined) {
            const v = d[key]
            if (v !== undefined) { if (!prop.f(v, E, E ? ip + '/' + prop.ek : '', E ? sp + '/properties/' + prop.ek : '', sc, st, NONE, b)) { ok = false; if (!E) return false } }
            else if (reqInProps !== null && reqInProps.includes(key)) { ok = false; if (!E) return false; E.push(err('required', ip, sp + '/required', { missingProperty: key }, `must have required property '${key}'`)) }
            evaluated = true
          }
          if (pats !== null && seen) {
            for (const p of pats) if (p.re.test(key)) {
              if (!p.f(d[key], E, E ? ip + '/' + esc(key) : '', E ? sp + '/patternProperties/' + p.es : '', sc, st, NONE, b)) { ok = false; if (!E) return false }
              evaluated = true
            }
          }
          if (!evaluated && seen && ap !== undefined) {
            if (ap === false) { ok = false; if (!E) return false; E.push(err('additionalProperties', ip, sp + '/additionalProperties', { additionalProperty: key }, 'must NOT have additional properties')) }
            else if (!apf(d[key], E, E ? ip + '/' + esc(key) : '', E ? sp + '/additionalProperties' : '', sc, st, NONE, b)) { ok = false; if (!E) return false }
            evaluated = true
          }
          if (evaluated && a !== NONE) (a.p || (a.p = new Set())).add(key)
        }
        return ok
      })
    }
    const inPlace = (list, path) => list.map(([k, x]) => [k, get(x), path(k)])
    if (isObj(s.dependentSchemas)) {
      const deps = inPlace(Object.entries(s.dependentSchemas), (k) => '/dependentSchemas/' + esc(k))
      step((d, E, ip, sp, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        let ok = true
        for (const [k, f, p] of deps) if (has(d, k)) { const sub = ann(); if (!f(d, E, ip, E ? sp + p : '', sc, st, sub, b)) { ok = false; if (!E) return false } else if (a !== NONE) merge(a, sub) }
        return ok
      })
    }
    if (isObj(s.propertyDependencies)) {
      const deps = Object.entries(s.propertyDependencies).filter(([, c]) => isObj(c)).map(([k, c]) => [k, new Map(Object.keys(c).map((v) => [v, { f: get(c[v]), p: '/propertyDependencies/' + esc(k) + '/' + esc(v) }]))])
      step((d, E, ip, sp, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        let ok = true
        for (const [k, choices] of deps) {
          if (!has(d, k) || typeof d[k] !== 'string') continue
          const ch = choices.get(d[k]); if (ch === undefined) continue
          const sub = ann(); if (!ch.f(d, E, ip, sp + ch.p, sc, st, sub, b)) { ok = false; if (!E) return false } else if (a !== NONE) merge(a, sub)
        }
        return ok
      })
    }

    // in-place applicators
    const title = (x) => isObj(x) && typeof x.title === 'string' ? x.title : ''
    if (Array.isArray(s.allOf)) {
      const fs = s.allOf.map(get)
      step((d, E, ip, sp, sc, st, a, b) => {
        let ok = true
        for (let i = 0; i < fs.length; i++) { const sub = ann(); if (!fs[i](d, E, ip, E ? sp + '/allOf/' + i : '', sc, st, sub, b)) { ok = false; if (!E) return false } else if (a !== NONE) merge(a, sub) }
        return ok
      })
    }
    for (const kw of ['anyOf', 'oneOf']) {
      if (!Array.isArray(s[kw])) continue
      const fs = s[kw].map(get); const titles = s[kw].map(title)
      step((d, E, ip, sp, sc, st, a, b) => {
        let n = 0; let win = null
        for (let i = 0; i < fs.length; i++) {
          const sub = ann()
          if (fs[i](d, null, '', '', sc, st, sub, b)) {
            n++
            if (kw === 'anyOf') { if (a !== NONE) merge(a, sub); else return true } else win = sub
          }
        }
        if (kw === 'anyOf' ? n > 0 : n === 1) { if (kw === 'oneOf' && a !== NONE) merge(a, win); return true }
        if (E) {
          const br = []
          for (let i = 0; i < fs.length; i++) { const scratch = []; br.push({ valid: fs[i](d, scratch, ip, sp + '/' + kw + '/' + i, sc, st, NONE, b), errors: scratch, title: titles[i] }) }
          const c = collapse(kw, br, ip, sp + '/' + kw, null); if (c !== null) E.push(c)
        }
        return false
      })
    }
    if (s.not !== undefined) {
      const f = get(s.not)
      step((d, E, ip, sp, sc, st, a, b) => { if (!f(d, null, '', '', sc, st, NONE, b)) return true; if (E) E.push(err('not', ip, sp + '/not', {}, 'must NOT be valid')); return false })
    }
    if (s.if !== undefined) {
      const fi = get(s.if); const th = s.then !== undefined ? get(s.then) : null; const el = s.else !== undefined ? get(s.else) : null
      step((d, E, ip, sp, sc, st, a, b) => {
        const isub = ann()
        if (fi(d, null, '', '', sc, st, isub, b)) {
          if (a !== NONE) merge(a, isub)
          if (!th) return true
          const sub = ann(); if (!th(d, E, ip, E ? sp + '/then' : '', sc, st, sub, b)) return false
          if (a !== NONE) merge(a, sub); return true
        }
        if (!el) return true
        const sub = ann(); if (!el(d, E, ip, E ? sp + '/else' : '', sc, st, sub, b)) return false
        if (a !== NONE) merge(a, sub); return true
      })
    }

    // unevaluated*, last, against what everything above evaluated
    const uP = s.unevaluatedProperties; const uI = s.unevaluatedItems
    const uPf = uP !== undefined && uP !== false ? get(uP) : null
    const uIf = uI !== undefined && uI !== false ? get(uI) : null
    if (uP !== undefined) {
      step((d, E, ip, sp, sc, st, a, b) => {
        if (bits(d) !== O_) return true
        let ok = true
        for (const key of Object.keys(d)) {
          if (a.p && a.p.has(key)) continue
          if (uP === false) { ok = false; if (!E) return false; E.push(err('unevaluatedProperties', ip, sp + '/unevaluatedProperties', { unevaluatedProperty: key }, 'must NOT have unevaluated properties')) }
          else if (!uPf(d[key], E, E ? ip + '/' + esc(key) : '', E ? sp + '/unevaluatedProperties' : '', sc, st, NONE, b)) { ok = false; if (!E) return false }
          ;(a.p || (a.p = new Set())).add(key)
        }
        return ok
      })
    }
    if (uI !== undefined) {
      step((d, E, ip, sp, sc, st, a, b) => {
        if (!Array.isArray(d)) return true
        let ok = true
        for (let i = 0; i < d.length; i++) {
          if (a.i && a.i.has(i)) continue
          if (uI === false) { if (E) E.push(err('unevaluatedItems', ip, sp + '/unevaluatedItems', { limit: i }, 'must NOT have more than ' + i + ' items')); return false }
          if (!uIf(d[i], E, E ? ip + '/' + i : '', E ? sp + '/unevaluatedItems' : '', sc, st, NONE, b)) { ok = false; if (!E) return false }
          ;(a.i || (a.i = new Set())).add(i)
        }
        return ok
      })
    }

    const n = steps.length
    const own = track && (uP !== undefined || uI !== undefined)
    return (d, E, ip, sp, sc, st, sink, b) => {
      const base = fixed !== undefined ? fixed : b
      if (tracked) {
        for (let i = st.length - 2; i >= 0; i -= 2) if (st[i] === s && st[i + 1] === d) return true
        st.push(s, d)
      }
      let pushed = false
      if (sc[sc.length - 1] !== base) { sc.push(base); pushed = true }
      const a = track && (sink !== NONE || own) ? { p: null, i: null } : NONE
      let ok = true
      for (let i = 0; i < n; i++) if (!steps[i](d, E, ip, sp, sc, st, a, base)) { ok = false; if (!E) break }
      if (pushed) sc.pop()
      if (tracked) st.length -= 2
      if (ok && a !== NONE && sink !== NONE) merge(sink, a)
      return ok
    }
  }

  const fn = get(root)
  return {
    dataContext: false,
    isValid: (data) => fn(data, null, '', '#', [top], [], NONE, top),
    validate: (data) => { const E = []; return fn(data, E, '', '#', [top], [], NONE, top) ? { valid: true, data, errors: [] } : { valid: false, errors: E }; },
  }
}

module.exports = { createSmall }
