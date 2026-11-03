// IR backend: closures. It knows the IR operations (README.md) and
// nothing about JSON Schema. Each procedure becomes a function over a frame
// (an array); variable names are resolved to slots once, here.
//
// A statement returns 1 to return false from its procedure (a failed verdict)
// and 0 to go on.

import { E, own, keysOf, seg, newAnn, mergeAnn, isObj, relate, setOwn, copyOf } from '../kernels/rt.mjs'
import * as kernels from '../kernels/kernels.mjs'
import { front, orderSkeleton, needsOrder, normalize } from './front.mjs'
// Filling defaults is its own pass, shared with the current engine and its
// compiled modules (lib/defaults.js): it runs before validation, in place.
import defaults from '../defaults.js'
import { buildCoercer, buildRemover, resolveSchemaByPath, stripOrdinal, resolveSchemaForPreprocess } from '../kernels/preprocess.mjs'
import dialect from '../dialect.js'
import pointer from '../pointer.js'
import errorMessages from '../error-messages.js'
import enrichLib from '../enrich-error.js'
import { typeBit, dataBits, dataCtx, reread, ctxRoot, setCtxRoot } from '../kernels/custom.mjs'

const PN = ({}).__proto__ === Object.prototype
const NONE = Object.freeze([])
const PARAMS = ['d', 'e', 's', 'P', 'V', 'SP', 'A']
const [, iE, iS, , , , iA] = PARAMS.map((_, i) => i)

export function compileIR (ir, { richErrors = true } = {}) {
  // Errors a custom keyword writes name their own paths: always sorted then.
  const SK = ir.custom || needsOrder(ir.schema) ? orderSkeleton(ir.schema) : null
  // The document being validated, for the errors a custom keyword writes:
  // their received value is read from it by path, as the current engine does.
  let ROOT
  const plain = richErrors === false
  // A call that gathers no errors reads no instance or schema path, unless a
  // custom keyword is in the schema (its function is given the paths), so
  // such a call is not given the strings it would build for them.
  const QUIET = !ir.custom
  const fns = new Map()
  // The dynamic scope: resources entered on the way here.
  let SC = null
  const pick = (table, fallback) => {
    const chain = []
    for (let c = SC; c !== null; c = c.up) chain.push(c.b)
    for (let i = chain.length - 1; i >= 0; i--) { const g = table.get(chain[i]); if (g !== undefined) return g }
    return fallback
  }
  const procFn = (id) => {
    if (fns.has(id)) return fns.get(id)
    const cell = { f: null }
    const call = (d, e, s, P, V, SP, A) => cell.f(d, e, s, P, V, SP, A)
    fns.set(id, call)
    const p = ir.procs.get(id)
    const slots = new Map(PARAMS.map((n, i) => [n, i]))
    const slot = (n) => { if (!slots.has(n)) slots.set(n, slots.size); return slots.get(n) }
    const body = stmt(p.body, slot)
    const width = slots.size
    const ann = p.mode === 'ann'
    const base = p.base
    // A procedure that can reach itself on the same value (lib/ir/front.mjs
    // `guard`): a second entry with the same value answers with no error.
    const run = (d, e, s, P, V, SP, A) => {
      const f = new Array(width)
      f[0] = d; f[1] = e; f[2] = s; f[3] = P; f[4] = V; f[5] = SP; f[6] = ann && (A === null || A === undefined) ? newAnn() : A
      if (!ir.dynamic) return body(f) === 0
      const saved = SC
      if (SC === null || SC.b !== base) SC = { b: base, up: SC }
      try { return body(f) === 0 } finally { SC = saved }
    }
    cell.f = run
    return call
  }

  function stmt (n, slot) {
    switch (n.t) {
      case 'seq': {
        // Short sequences are unrolled: a loop over an array of closures is
        // one megamorphic call site V8 cannot inline through.
        const b = n.body.map((x) => stmt(x, slot))
        if (b.length === 0) return () => 0
        if (b.length === 1) return b[0]
        const pair = (x, y) => (f) => x(f) === 1 ? 1 : y(f)
        const tree = (lo, hi) => hi - lo === 1 ? b[lo] : pair(tree(lo, (lo + hi) >> 1), tree((lo + hi) >> 1, hi))
        return tree(0, b.length)
      }
      case 'props': {
        const all = stmt({ t: 'seq', body: n.body }, slot)
        // Below this many names a lookup per name costs less than listing the
        // object's names. On SchemaStore's samples with code generation
        // blocked, the median verdict was 3.26x the interpreter's at 32, 3.00x
        // at 8 and 2.95x at 4.
        if (n.keyed === null || n.keyed.length < 4) return all
        const b = n.body.map((x) => stmt(x, slot))
        const keyed = new Set(n.keyed.map(([, i]) => i))
        const byName = new Map(n.keyed.map(([p, i]) => [p, b[i]]))
        const always = b.filter((_, i) => !keyed.has(i))
        const xi = slot(n.x.n); const want = n.keyed.length
        // A verdict on an object with fewer own names than the schema lists:
        // visit its names. An entry runs only for a name that is an own
        // property with a defined value (the entry checks that itself), so
        // the names it would skip are names the object does not have. Errors
        // keep the schema's order, and so the lookups.
        return (f) => {
          if (f[iE] !== null) return all(f)
          const names = Object.getOwnPropertyNames(f[xi])
          if (names.length >= want) return all(f)
          for (let j = 0; j < always.length; j++) if (always[j](f) === 1) return 1
          for (let j = 0; j < names.length; j++) { const g = byName.get(names[j]); if (g !== undefined && g(f) === 1) return 1 }
          return 0
        }
      }
      case 'if': {
        const t = stmt(n.then, slot); const e = n.else ? stmt(n.else, slot) : null
        if (!e && n.c.t === 'not') { const c = expr(n.c.e, slot); return (f) => c(f) ? 0 : t(f) }
        const c = expr(n.c, slot)
        return e ? (f) => c(f) ? t(f) : e(f) : (f) => c(f) ? t(f) : 0
      }
      case 'let': {
        const i = slot(n.name); const b = stmt(n.body, slot)
        if (n.value.t === 'get' && n.value.o.t === 'var' && n.value.k.t === 'lit') { const o = slot(n.value.o.n); const k = n.value.k.v; return (f) => { f[i] = f[o][k]; return b(f) } }
        const v = expr(n.value, slot)
        return (f) => { f[i] = v(f); return b(f) }
      }
      case 'bind': {
        const is = n.names.map(([name]) => slot(name)); const vs = n.names.map(([, value]) => expr(value, slot))
        if (is.length === 2) { const [i0, i1] = is; const [v0, v1] = vs; return (f) => { f[i0] = v0(f); f[i1] = v1(f); return 0 } }
        return (f) => { for (let j = 0; j < is.length; j++) f[is[j]] = vs[j](f); return 0 }
      }
      case 'keys': {
        const o = expr(n.obj, slot); const i = slot(n.k); const b = stmt(n.body, slot)
        if (n.order === 'forin') return (f) => { const x = o(f); for (const k in x) { f[i] = k; if (b(f) === 1) return 1 } return 0 }
        const list = n.order === 'protoLast' ? keysOf : Object.keys
        return (f) => { const ks = list(o(f)); for (let j = 0; j < ks.length; j++) { f[i] = ks[j]; if (b(f) === 1) return 1 } return 0 }
      }
      case 'range': {
        const a = expr(n.arr, slot); const from = typeof n.from === 'number' ? () => n.from : expr(n.from, slot); const i = slot(n.i); const b = stmt(n.body, slot)
        return (f) => { const x = a(f); for (let j = from(f); j < x.length; j++) { f[i] = j; if (b(f) === 1) return 1 } return 0 }
      }
      case 'count': {
        const i = slot(n.name); const b = stmt(n.body, slot)
        return (f) => { f[i] = 0; return b(f) }
      }
      case 'incr': { const i = slot(n.name); return (f) => { f[i]++; return 0 } }
      case 'do': { const e = expr(n.e, slot); return (f) => { e(f); return 0 } }
      case 'ret': return () => 1
      case 'require': {
        const e = expr(n.e, slot)
        return (f) => e(f) || f[iE] !== null ? 0 : 1
      }
      case 'fail': {
        const b = errBuilder(n.err, slot)
        return (f) => { const e = f[iE]; if (e === null || e === undefined) return 1; e.push(b(f)); return 0 }
      }
      case 'branches': return branches(n, slot)
      case 'custom': {
        // lib/interpreter-core.js runCustom: each keyword whose type admits
        // the value runs; the errors its function left on itself replace the
        // keyword's own error, and are cleared after every call.
        const x = expr(n.x, slot); const path = expr(n.path, slot); const sp = expr(n.sp, slot)
        const ops = n.ops.map((op) => ({ keyword: op.keyword, fn: op.fn, ctx: op.ctx === true, mask: op.types === null ? 127 : op.types.reduce((m, t) => m | typeBit(t), 0) }))
        const out = plain ? (r) => r : (r) => enrichLib.enrich(r, { data: ROOT })
        // `here`: the value read again from where it sits, as the current
        // engine reads it before the keywords declared post.
        const at0 = n.here ? (f) => { const p = path(f); if (p === '') return ROOT; const c = dataCtx(p, '', ''); return c.parentData !== null && typeof c.parentData === 'object' ? c.parentData[c.parentDataProperty] : x(f) } : x
        return (f) => {
          let v = at0(f); let bits = dataBits(v); const e = f[iE]
          for (let i = 0; i < ops.length; i++) {
            const op = ops[i]
            if ((bits & op.mask) === 0) continue
            let ok
            if (op.ctx) {
              const c = dataCtx(path(f), sp(f), op.keyword)
              ok = op.fn(v, c)
              const now = reread(c, v)
              if (now !== v) { v = now; bits = dataBits(v) }
            } else ok = op.fn(v)
            const holder = op.fn.source || op.fn
            const own = holder.errors
            if (own) holder.errors = null
            if (ok) continue
            if (e === null || e === undefined) return 1
            const at = path(f); const kwPath = sp(f) + '/' + op.keyword
            if (Array.isArray(own) && own.length > 0) {
              // A context-reading keyword writes the path it was given.
              for (const r of own) e.push(out({ keyword: r.keyword || op.keyword, instancePath: r.instancePath !== undefined ? (op.ctx ? r.instancePath : at + r.instancePath) : at, schemaPath: r.schemaPath !== undefined ? r.schemaPath : kwPath, params: r.params !== undefined ? r.params : {}, message: r.message !== undefined ? r.message : `must pass "${op.keyword}" keyword validation` }))
            } else e.push(out({ keyword: op.keyword, instancePath: at, schemaPath: kwPath, params: { keyword: op.keyword }, message: `must pass "${op.keyword}" keyword validation` }))
          }
          return 0
        }
      }
      case 'setDefault': { const o = expr(n.o, slot); const k = n.k; const v = n.v; return (f) => { const x = o(f); if (!own(x, k)) setOwn(x, k, copyOf(v)); return 0 } }
      case 'fcall': { const x = expr(n.x, slot); const p = procFn(n.proc); return (f) => { p(x(f)); return 0 } }
      case 'defaultsMask': {
        const o = expr(n.o, slot); const idx = new Map(n.entries.map(([k], i) => [k, i])); const N = n.entries.length
        return (f) => { const x = o(f); const seen = new Uint8Array(N); const ks = Object.getOwnPropertyNames(x); for (let j = 0; j < ks.length; j++) { const i = idx.get(ks[j]); if (i !== undefined) seen[i] = 1 } for (let i = 0; i < N; i++) if (seen[i] === 0) x[n.entries[i][0]] = copyOf(n.entries[i][1]); return 0 }
      }
      case 'fillWalk': {
        const o = expr(n.o, slot); const T = new Map(n.entries.map(([k, id]) => [k, procFn(id)]))
        return (f) => { const x = o(f); const ks = Object.getOwnPropertyNames(x); for (let j = 0; j < ks.length; j++) { const p = T.get(ks[j]); if (p !== undefined) p(x[ks[j]]) } return 0 }
      }
    }
    throw new Error('ir run: statement ' + n.t)
  }

  function errBuilder (er, slot) {
    const path = expr(er.path, slot); const sp = expr(er.sp, slot); const params = expr(er.params, slot); const msg = expr(er.msg, slot); const ev = expr(er.ev, slot)
    const detail = er.detail ? er.detail.fn : undefined; const suggest = er.suggest ? er.suggest.fn : undefined
    if (plain) return (f) => ({ keyword: er.kw, instancePath: path(f), schemaPath: sp(f), params: params(f), message: msg(f) })
    return (f) => E(er.code, er.kw, path(f), sp(f), params(f), msg(f), er.exp, er.rank, ev(f), f[iS], detail, suggest)
  }

  // anyOf / oneOf: every branch's verdict, or in error mode each branch's own
  // errors through the collapse. Annotations: `each` valid branch, or
  // `onlyIfOne` (oneOf keeps them only when exactly one passed).
  function branches (n, slot) {
    const x = expr(n.x, slot); const path = expr(n.path, slot); const sp = expr(n.sp, slot); const ev = expr(n.ev, slot)
    const sps = n.sps.map((e) => expr(e, slot))
    const ps = n.procs.map(procFn)
    const isAny = n.kw === 'anyOf'
    return (f) => {
      const A = f[iA]; const e = f[iE]
      const hold = n.ann === 'onlyIfOne' ? newAnn() : A
      const v = x(f)
      // An anyOf with no annotations and a list to fill runs each branch once
      // and stops at the first that passes (see the module writer's branches).
      if (isAny && !n.ann && e !== null && e !== undefined) {
        const br = []
        for (let i = 0; i < ps.length; i++) {
          const be = []
          ps[i](v, be, f[iS], path(f), ev(f), sps[i](f), undefined)
          if (be.length === 0) return 0
          br.push({ valid: false, errors: be })
        }
        const r = n.collapse(n.kw, br, path(f), sp(f), null, n.titles)
        if (r !== null) e.push(plain ? r : E(r.code, n.kw, path(f), sp(f), r.params, r.message, undefined, n.rank, ev(f), f[iS], undefined, undefined, r.branchErrors))
        return 0
      }
      // Otherwise the verdict first also when a list is filled: the branches'
      // errors are built only when the keyword fails. Not with custom
      // keywords, which may change the data and must run once.
      if (e === null || e === undefined || QUIET) {
        let c = 0
        for (let i = 0; i < ps.length; i++) {
          const a = n.ann ? newAnn() : undefined
          if (QUIET ? ps[i](v, null, f[iS], '', ev(f), '', a) : ps[i](v, null, f[iS], path(f), ev(f), sps[i](f), a)) { c++; if (n.ann) mergeAnn(hold, a); else if (isAny) break }
        }
        if (isAny ? c !== 0 : c === 1) {
          if (n.ann === 'onlyIfOne') mergeAnn(A, hold)
          return 0
        }
        if (e === null || e === undefined) return 1
      }
      const br = ps.map((p, i) => { const be = []; const a = n.ann ? newAnn() : undefined; p(v, be, f[iS], path(f), ev(f), sps[i](f), a); const ok = be.length === 0; if (ok && n.ann) mergeAnn(hold, a); return { valid: ok, errors: be } })
      const r = n.collapse(n.kw, br, path(f), sp(f), null, n.titles)
      if (r !== null) e.push(plain ? r : E(r.code, n.kw, path(f), sp(f), r.params, r.message, undefined, n.rank, ev(f), f[iS], undefined, undefined, r.branchErrors))
      else if (n.ann === 'onlyIfOne') mergeAnn(A, hold)
      return 0
    }
  }

  const GUARD = { isStr: kernels.isStr, isNum: kernels.isNum, isArr: kernels.isArr, isObjV: kernels.isObjV, isAny: kernels.isAny }

  // Superinstructions: an operand that is a variable or a literal is read
  // directly instead of through a closure of its own.
  const isVar = (e) => e.t === 'var'
  const isLit = (e) => e.t === 'lit'
  function expr (n, slot) {
    switch (n.t) {
      case 'get': if (isVar(n.o) && isLit(n.k)) { const o = slot(n.o.n); const k = n.k.v; return (f) => f[o][k] } break
      case 'own': if (isVar(n.o) && isLit(n.k)) { const o = slot(n.o.n); const k = n.k.v; return (f) => own(f[o], k) } if (isVar(n.o) && isVar(n.k)) { const o = slot(n.o.n); const k = slot(n.k.n); return (f) => own(f[o], f[k]) } break
      case 'cmp': if (isVar(n.a) && isLit(n.b)) {
        const a = slot(n.a.n); const v = n.b.v
        switch (n.op) { case '===': return (f) => f[a] === v; case '!==': return (f) => f[a] !== v; case '<': return (f) => f[a] < v; case '>': return (f) => f[a] > v }
      } break
      case 'type': if (isVar(n.x) && n.types.length === 1) { const i = slot(n.x.n); const t = kernels.TYPES[n.types[0]] || (() => false); return (f) => t(f[i]) } break
      case 'kernel': if (isVar(n.x)) { const i = slot(n.x.n); const ok = n.K.ok; const pv = n.pv; return (f) => ok(f[i], pv) } break
      case 'guard': if (isVar(n.x)) { const i = slot(n.x.n); const g = GUARD[n.g]; return (f) => g(f[i]) } break
      case 'and': if (isVar(n.a)) { const a = slot(n.a.n); const b = expr(n.b, slot); return (f) => f[a] && b(f) } break
      case 'or': if (isVar(n.a)) { const a = slot(n.a.n); const b = expr(n.b, slot); return (f) => f[a] || b(f) } break
    }
    switch (n.t) {
      case 'lit': { const v = n.v; return () => v }
      case 'var': { const i = slot(n.n); return (f) => f[i] }
      case 'get': { const o = expr(n.o, slot); const k = expr(n.k, slot); return (f) => o(f)[k(f)] }
      case 'field': { const o = expr(n.o, slot); const k = n.k; return (f) => o(f)[k] }
      case 'own': { const o = expr(n.o, slot); const k = expr(n.k, slot); return (f) => own(o(f), k(f)) }
      case 'not': { const e = expr(n.e, slot); return (f) => !e(f) }
      case 'and': { const a = expr(n.a, slot); const b = expr(n.b, slot); return (f) => a(f) && b(f) }
      case 'or': { const a = expr(n.a, slot); const b = expr(n.b, slot); return (f) => a(f) || b(f) }
      case 'cmp': {
        const a = expr(n.a, slot); const b = expr(n.b, slot)
        switch (n.op) {
          case '===': return (f) => a(f) === b(f)
          case '!==': return (f) => a(f) !== b(f)
          case '<': return (f) => a(f) < b(f)
          case '>': return (f) => a(f) > b(f)
        }
        throw new Error('ir run: cmp ' + n.op)
      }
      case 'isObj': { const x = expr(n.x, slot); return (f) => isObj(x(f)) }
      case 'isArr': { const x = expr(n.x, slot); return (f) => Array.isArray(x(f)) }
      case 'isObjAny': { const x = expr(n.x, slot); return (f) => { const v = x(f); return typeof v === 'object' && v !== null } }
      case 'len': { const x = expr(n.x, slot); return (f) => x(f).length }
      case 'plainProto': { const x = expr(n.x, slot); return (f) => { const v = x(f); return (PN ? v.__proto__ : Object.getPrototypeOf(v)) === Object.prototype } }
      case 'type': {
        const x = expr(n.x, slot); const ts = n.types.map((t) => kernels.TYPES[t] || (() => false))
        return ts.length === 1 ? ((t) => (f) => t(x(f)))(ts[0]) : (f) => { const v = x(f); for (const t of ts) if (t(v)) return true; return false }
      }
      case 'guard': { const x = expr(n.x, slot); const g = GUARD[n.g]; return (f) => g(x(f)) }
      case 'kernel': { const x = expr(n.x, slot); const ok = n.K.ok; const pv = n.pv; return (f) => ok(x(f), pv) }
      case 'kfail': { const x = expr(n.x, slot); const fl = n.K.fail; const pv = n.pv; return (f) => fl(x(f), pv) }
      case 'known': {
        const k = expr(n.k, slot); const names = new Set(n.names); const res = n.pats.map((p) => new RegExp(p, 'u'))
        if (res.length === 0) return (f) => names.has(k(f))
        return (f) => { const v = k(f); if (names.has(v)) return true; for (const re of res) if (re.test(v)) return true; return false }
      }
      case 're': { const re = new RegExp(n.src, 'u'); const k = expr(n.k, slot); return (f) => re.test(k(f)) }
      case 'seg': { const k = expr(n.k, slot); return (f) => seg(k(f)) }
      case 'cat': { const a = expr(n.a, slot); const b = expr(n.b, slot); return (f) => a(f) + b(f) }
      case 'str': { const ps = n.parts.map((p) => expr(p, slot)); return (f) => ps.map((p) => p(f)).join('') }
      case 'obj': { const fs = n.fields.map(([k, v]) => [k, expr(v, slot)]); return (f) => { const o = {}; for (const [k, v] of fs) o[k] = v(f); return o } }
      case 'annKey': { const k = expr(n.k, slot); return (f) => { const A = f[iA]; (A.p === null ? A.p = new Set() : A.p).add(k(f)) } }
      case 'annHasKey': { const k = expr(n.k, slot); return (f) => { const A = f[iA]; return A.p !== null && A.p.has(k(f)) } }
      case 'annPrefix': { const a = expr(n.arr, slot); const m = n.n; return (f) => { const A = f[iA]; A.n = Math.max(A.n, Math.min(m, a(f).length)) } }
      case 'annAll': return (f) => { f[iA].all = true }
      case 'annAllSet': return (f) => f[iA].all
      case 'annAt': { const i = expr(n.i, slot); return (f) => { const A = f[iA]; (A.at === null ? A.at = new Set() : A.at).add(i(f)) } }
      case 'annAtHas': { const i = expr(n.i, slot); return (f) => { const A = f[iA]; return A.at !== null && A.at.has(i(f)) } }
      case 'annN': return (f) => f[iA].n
      case 'firstUneval': { const x = expr(n.x, slot); return (f) => { const A = f[iA]; const v = x(f); let j = A.n; if (A.at !== null) while (j < v.length && A.at.has(j)) j++; return j } }
      case 'pcall': return pcall(n, slot)
    }
    throw new Error('ir run: expression ' + n.t)
  }

  // A procedure called in place. Its validity: the verdict it returns, or in
  // error mode whether the error list grew. Under `merge` it gets a collector
  // of its own, merged into this frame's when valid.
  function pcall (n, slot) {
    const x = expr(n.x, slot)
    const path = n.path ? expr(n.path, slot) : () => ''
    const sp = n.sp ? expr(n.sp, slot) : () => ''
    const ev = n.ev ? expr(n.ev, slot) : x
    const table = n.dynamic ? new Map(n.dynamic.map(([b, id]) => [b, procFn(id)])) : null
    // No fixed target: a v1 $dynamicRef that resolves only on the scope; when
    // nothing on the scope matches, its error (n.missing).
    const fixed = n.proc === null ? null : procFn(n.proc)
    const target = table ? () => pick(table, fixed) : () => fixed
    const missing = n.missing ? errBuilder(n.missing, slot) : null
    const inherit = n.e === 'inherit'
    // `fresh`: errors gathered and set aside, so every keyword of the
    // subschema runs, as the current engine runs it under ctx.
    const fresh = n.e === 'fresh'
    // A call on a cycle (lib/ir/front.mjs `guard`): it keeps the values it is
    // on and answers a second entry with no error, as the current engine cuts
    // a reference it meets again.
    const active = n.guard ? new Set() : null
    const through = active === null ? null : (t) => (d, e, s, P, V, SP, A) => {
      if (active.has(d)) return true
      active.add(d)
      try { return t(d, e, s, P, V, SP, A) } finally { active.delete(d) }
    }
    return (f) => {
      const e = inherit ? f[iE] : fresh ? [] : null
      let t = target()
      if (through !== null && t !== null) t = through(t)
      if (t === null) { if (e) e.push(missing(f)); return false }
      const a = n.ann === 'merge' ? newAnn() : null
      const before = e ? e.length : 0
      const ok = e === null && QUIET ? t(x(f), null, f[iS], '', ev(f), '', a) : t(x(f), e, f[iS], path(f), ev(f), sp(f), a) && (!e || e.length === before)
      if (ok && a !== null) mergeAnn(f[iA], a)
      return ok
    }
  }

  const dual = procFn(ir.dual)
  const verdict = procFn(ir.verdict)
  if (ir.ctx) {
    // One walk answers both, as the current engine's collecting walk does:
    // a keyword that changes the value runs once. The document is the root
    // its keywords read their context from, kept across a nested validate().
    const run = (d) => {
      const outer = ctxRoot(); setCtxRoot({ _ctxRoot: d }); ROOT = d
      const e = []
      try { dual(d, e, !(!d && d !== 0 && d !== false), '', d, '#', null) } finally { setCtxRoot(outer) }
      if (e.length === 0) return { valid: true, data: d, errors: NONE }
      const o = SK === null ? e : kernels.ordered(SK, e)
      return { valid: false, errors: ir.relate && !plain && o.length > 1 ? relate(o) : o }
    }
    return { fill: (id) => { const p = procFn(id); return (d) => { p(d) } }, isValid: (d) => run(d).valid, validate: run }
  }
  return {
    fill: (id) => { const p = procFn(id); return (d) => { p(d) } },
    isValid: (d) => { ROOT = d; return verdict(d, null, true, '', d, '#', null) },
    validate (d) {
      // The current engine's result: the value it checked, after defaults.
      ROOT = d
      if (verdict(d, null, true, '', d, '#', null)) return { valid: true, data: d, errors: NONE }
      const e = []
      // lib/enrich-error.js resolveAt: a falsy root other than 0 and false
      // reports no received value on any error.
      dual(d, e, !(!d && d !== 0 && d !== false), '', d, '#', null)
      const o = SK === null ? e : kernels.ordered(SK, e)
      return { valid: false, errors: ir.relate && !plain && o.length > 1 ? relate(o) : o }
    },
  }
}

function hasDefault (s) {
  if (typeof s !== 'object' || s === null) return false
  if (Array.isArray(s)) return s.some(hasDefault)
  if ('default' in s) return true
  for (const k in s) if (hasDefault(s[k])) return true
  return false
}

// The passes before the check, in the current engine's order (lib/validator-
// core.js): additional properties removed, values coerced, defaults filled.
// Any true value turns either option on, as there; coerceTypes: 'array' also
// wraps a lone top-level value of an array property.
export function preprocessOptions (opts) {
  return { coerce: !!opts.coerceTypes, arrayMode: opts.coerceTypes === 'array', remove: !!opts.removeAdditional }
}

// The schema the passes read: references into the `schemas` documents
// followed, over the same map the current engine builds from them
// (lib/validator-core.js _buildSchemaMap, declaredId).
function preprocessSchemaOf (ir, schema, opts) {
  const schemas = opts.schemas
  if (!schemas || (Array.isArray(schemas) ? schemas.length === 0 : Object.keys(schemas).length === 0)) return ir.schema
  // The current engine adds the metaschemas to that map for a schema that
  // references one; not reproduced here.
  if (/"\$(?:ref|dynamicRef|recursiveRef)":"[^"]*json-schema\.org\//.test(JSON.stringify(schema))) throw new Error('ir: coerceTypes or removeAdditional with a reference to a metaschema is not supported')
  const inherit = schema && typeof schema === 'object' ? dialect.draftCode(schema.$schema) : 0
  const declaredId = (original, normalized) => {
    const n = normalized && typeof normalized === 'object' ? normalized.$id : undefined
    if (typeof n === 'string' && n !== '') return n
    const o = original && typeof original === 'object' ? original.$id : undefined
    if (typeof o === 'string' && o !== '' && o[0] !== '#') return o
    return undefined
  }
  const map = new Map()
  if (Array.isArray(schemas)) {
    for (const d of schemas) {
      const n = normalize(d, inherit); const id = declaredId(d, n)
      if (!id) throw new Error('Schema in schemas option must have $id')
      map.set(id, n)
    }
  } else {
    for (const [key, d] of Object.entries(schemas)) {
      const n = normalize(d, inherit); map.set(key, n)
      const id = declaredId(d, n)
      if (id && id !== key) map.set(id, n)
    }
  }
  return resolveSchemaForPreprocess(ir.schema, map)
}

// The current engine's abortEarly answer for any rejected document: one
// frozen error, shared (lib/validator-core.js ABORT_EARLY_RESULT).
const ABORT = Object.freeze({ valid: false, errors: Object.freeze([Object.freeze(Object.defineProperty({ code: 'ATA9000', message: 'validation failed', keyword: '__abort_early__', path: '' }, '_s', { value: true }))]) })

export function compile (schema, opts = {}) {
  const pp = preprocessOptions(opts)
  const rich = opts.richErrors !== false
  const verbose = opts.verbose === true
  const ir = front(schema, { assertFormat: opts.assertFormat !== false, schemas: opts.schemas || null, metaschemas: opts.metaschemas || null, errorMessages: true, formats: opts.formats || null, keywords: opts.keywords || null, baseURI: opts.baseURI || null })
  // Under verbose the errors are built as the current engine builds them:
  // plain, given the three fields, then enriched (lib/validator-core.js
  // _verboseWrap below the presentation layer).
  // Under ctx too: the current engine enriches those errors when they are
  // read, from the document as its keywords left it.
  const late = verbose || ir.ctx
  const engine = compileIR(ir, { richErrors: late ? false : opts.richErrors })
  let fill = null
  if (opts.useDefaults !== false && hasDefault(schema)) {
    // The specialized fill from the IR; the shared pass where it declined.
    if (ir.fill === 'generic') fill = defaults.buildDefaultsApplier(ir.schema)
    else if (ir.fill) fill = engine.fill(ir.fill)
  }
  const ppSchema = pp.coerce || pp.remove ? preprocessSchemaOf(ir, schema, opts) : ir.schema
  const passes = [pp.remove ? buildRemover(ppSchema) : null, pp.coerce ? buildCoercer(ppSchema, pp.arrayMode) : null, fill].filter(Boolean)
  const pre = passes.length === 0 ? null : passes.length === 1 ? passes[0] : (d) => { for (const p of passes) p(d) }
  const isValid = pre === null ? engine.isValid : (d) => { pre(d); return engine.isValid(d) }
  let validate = pre === null ? engine.validate : (d) => { pre(d); return engine.validate(d) }
  // abortEarly: the verdict, and the shared stub for a rejection.
  if (opts.abortEarly === true) validate = (d) => isValid(d) ? { valid: true, data: d, errors: NONE } : ABORT
  if (late) {
    const inner = validate
    const root = ir.schema
    validate = (d) => {
      const r = inner(d)
      if (r.valid) return r
      let errs = !verbose ? r.errors : r.errors.map((err) => {
        if (!err || err.parentSchema !== undefined) return err
        const parentSchema = resolveSchemaByPath(root, err.schemaPath)
        const sp = typeof err.schemaPath === 'string' ? err.schemaPath : ''
        const last = sp.slice(sp.lastIndexOf('/') + 1).replace(/~1/g, '/').replace(/~0/g, '~')
        const keywordSchema = parentSchema !== null && typeof parentSchema === 'object' && last ? parentSchema[last] : undefined
        return { ...err, parentSchema, schema: keywordSchema, data: pointer.resolvePointer(d, err.instancePath, undefined) }
      })
      if (rich) {
        errs = errs.map((e) => enrichLib.enrich(e, { data: d }))
        if (ir.relate && errs.length > 1) errs = relate(errs)
      } else errs = errs.map(stripOrdinal)
      return { valid: false, errors: errs }
    }
  }
  // Custom messages over the finished errors, outermost, as the current
  // engine layers them (lib/validator-core.js), resolved in the same schema.
  if (errorMessages.schemaHasErrorMessages(JSON.stringify(ir.schema))) {
    const inner = validate
    validate = (d) => {
      const r = inner(d)
      if (r.valid || r === ABORT || !r.errors.length) return r
      const o = errorMessages.applyErrorMessages(r.errors, ir.schema)
      return o === r.errors ? r : { valid: false, errors: o }
    }
  }
  return { isValid, validate }
}
