// The closure backend's kernels (lib/ir/closures.mjs writes the modules that
// call them): a schema node is one closure, made when the module loads, that
// runs the node's checks in the order the schema declares them. That is the
// order the current engine reports errors in, so a form needs no sorting, and
// a check is a few branches of one function, not a step an interpreter
// dispatches. Plain errors only (richErrors: false): the keyword, both paths,
// the params and the message, as lib/kernels/kernels.mjs defines them for
// each keyword.
//
// A node is (d, e, ip, sp, o) => boolean: e is the error list, or null for a
// verdict, which stops at the first failure; paths are joined only when e is
// a list, and only for a value that fails. `o`, for a node of value checks
// under a loop, runs one of its checks alone (see code 15 below).
import { cpLen, own, seg } from './rt.mjs'

const fail = (e, kw, ip, sp, params, message) => { e.push({ keyword: kw, instancePath: ip, schemaPath: sp + '/' + kw, params, message }); return false }
// Type bits: an integer also carries `number`, a number that is not finite
// carries none (TYPES in ./kernels.mjs).
const TN = 'string number integer boolean null object array'.split(' ')
const bits = (d) => typeof d === 'string' ? 1 : typeof d === 'number' ? (Number.isInteger(d) ? 6 : isFinite(d) ? 2 : 0) : typeof d === 'boolean' ? 8 : d === null ? 16 : Array.isArray(d) ? 64 : typeof d === 'object' ? 32 : 0
// A `type` operand, written as one type's bit or as the list of names, as
// the check holds it: the bits it accepts and the schema's value.
const mask = (n) => typeof n === 'number' ? [n, TN[Math.log2(n)]] : [n.reduce((m, t) => m | 1 << TN.indexOf(t), 0), n]
const tFail = (e, ip, sp, n) => fail(e, 'type', ip, sp, { type: n[1] }, 'must be ' + (typeof n[1] === 'string' ? n[1] : n[1].join(', ')))

// A value's checks by code: 0 type, 1 minLength, 2 maxLength, 3 pattern,
// 4 format, 5 minimum, 6 maximum, 7 exclusiveMinimum, 8 exclusiveMaximum,
// 9 multipleOf, 10 enum, 11 const (primitives), 12 minItems, 13 maxItems,
// 14 uniqueItems (its operand the duplicate search), 15 items.
// `bad` is whether check k (1 to 14) fails on d, whose kind t is 1 for a
// string, 2 for a number, 3 for an array: the checks of ./kernels.mjs in one
// function, so a verdict makes no call per check. A string has between half
// its length and its length in code points, so the length settles most
// length checks and the count runs only near the bound.
const bad = (k, d, n, t) => k < 5
  ? t === 1 && (k === 1 ? d.length < n || (d.length < 2 * n && cpLen(d) < n) : k === 2 ? d.length > n && (d.length > 2 * n || cpLen(d) > n) : !(k === 3 ? n[0].test(d) : n[0](d)))
  : k < 10
    ? t === 2 && (k === 5 ? d < n : k === 6 ? d > n : k === 7 ? d <= n : k === 8 ? d >= n : !(n !== 0 && (Number.isInteger(d / n) || Math.abs(d / n - Math.round(d / n)) < 1e-9)))
    : k < 12 ? (k === 10 ? n.indexOf(d) === -1 : d !== n) : t === 3 && (k === 12 ? d.length < n : k === 13 ? d.length > n : n(d) !== null)
const KW = 'minLength maxLength pattern format minimum maximum exclusiveMinimum exclusiveMaximum multipleOf enum const minItems maxItems uniqueItems'.split(' ')
const OP = ['>=', '<=', '>', '<']
// The error of check k: its params and its message.
const report = (e, k, n, d, ip, sp) => {
  const few = k < 3 || k === 12 || k === 13
  const p = k === 14 ? n(d) : 0
  return fail(e, KW[k - 1], ip, sp,
    few ? { limit: n } : k < 5 ? { [KW[k - 1]]: n[1] } : k < 9 ? { comparison: OP[k - 5], limit: n } : k === 9 ? { multipleOf: n } : k === 10 ? { allowedValues: n } : k === 11 ? { allowedValue: n } : { i: p[0], j: p[1] },
    few ? `must NOT have ${k % 2 ? k === 13 ? 'more' : 'fewer' : k === 12 ? 'fewer' : 'more'} than ${n} ${k < 3 ? 'characters' : 'items'}` : k < 5 ? `must match ${KW[k - 1]} "${n[1]}"` : k < 9 ? `must be ${OP[k - 5]} ${n}` : k === 9 ? `must be multiple of ${n}` : k === 10 ? 'must be equal to one of the allowed values' : k === 11 ? 'must be equal to constant' : `must NOT have duplicate items (items ## ${p[1]} and ${p[0]} are identical)`)
}

// A node of value checks: c is [code, operand, ...] in the schema's order.
// A pattern's operand is its source, compiled here.
export const cVal = (c) => {
  let loop = false
  for (let i = 0; i < c.length; i += 2) { const k = c[i]; if (k === 15) loop = true; c[i + 1] = k === 0 ? mask(c[i + 1]) : k === 3 ? [new RegExp(c[i + 1], 'u'), c[i + 1]] : c[i + 1] }
  const f = (d, e, ip, sp, o) => {
    let ok = true
    const t = typeof d === 'string' ? 1 : typeof d === 'number' ? 2 : Array.isArray(d) ? 3 : 0
    for (let i = o === undefined ? 0 : o, end = o === undefined ? c.length : o + 2; i < end; i += 2) {
      const k = c[i]; const n = c[i + 1]
      if (k === 15) {
        if (t !== 3) continue
        // Under a node with several checks the errors come check by check,
        // every item's first before any item's second: schema order. A
        // value that passes is not walked again for its errors.
        for (let q = n.k > 2 && e !== null ? 0 : void 0; ; q += 2) {
          for (let j = 0; j < d.length; j++) if (!n(d[j], null, '', '', q)) { if (e === null) return false; ok = n(d[j], e, ip + '/' + j, sp + '/items', q) }
          if (!(q + 2 < n.k)) break
        }
      } else if (k === 0 ? (bits(d) & n[0]) === 0 : bad(k, d, n, t)) { if (e === null) return false; ok = k === 0 ? tFail(e, ip, sp, n) : report(e, k, n, d, ip, sp) }
    }
    return ok
  }
  // How many checks it has, for a loop that runs them one at a time; a node
  // with a loop of its own is not run that way (the module sorts instead).
  if (!loop) f.k = c.length
  return f
}

// An object node. `order` names its keywords in the schema's order: t type,
// p properties, r required, c additionalProperties false. props is [name,
// node, ...]; req the required names, or as a number the properties that are
// required, bit i for the i-th; type as cVal takes it, when it is not
// "object". A name is present the current engine's way: an own key, and on an
// object whose prototype is Object.prototype a defined value under a name
// that prototype lacks.
export const cObj = (order, props, req, type = 32) => {
  const names = []; const nodes = []; const segs = []
  for (let i = 0; i < props.length; i += 2) { names.push(props[i]); nodes.push(props[i + 1]); segs.push('/' + seg(props[i])) }
  const rq = typeof req === 'number' ? names.filter((_, i) => req >>> i & 1) : req
  // Whether a name needs the own-property test on an ordinary object too.
  const inh = (k) => k in Object.prototype
  const pi = names.map(inh); const ri = rq ? rq.map(inh) : []
  const m = mask(type); const n = names.length
  return (d, e, ip, sp) => {
    const o = typeof d === 'object' && d !== null && !Array.isArray(d)
    const p = o && Object.getPrototypeOf(d) === Object.prototype
    let ok = true
    for (let x = 0; x < order.length; x++) {
      const c = order[x]
      if (c === 't') { if ((bits(d) & m[0]) === 0) { if (e === null) return false; ok = tFail(e, ip, sp, m) } continue }
      if (!o) continue
      if (c === 'r') { for (let i = 0; i < rq.length; i++) if (d[rq[i]] === undefined || !(p && !ri[i] || own(d, rq[i]))) { if (e === null) return false; ok = fail(e, 'required', ip, sp, { missingProperty: rq[i] }, `must have required property '${rq[i]}'`) } }
      else if (c === 'p') {
        for (let i = 0; i < n; i++) {
          const y = d[names[i]]
          // A value that passes is not walked again for errors.
          if (y !== undefined && (p && !pi[i] || own(d, names[i])) && !nodes[i](y, null, '', '')) { if (e === null) return false; ok = nodes[i](y, e, ip + segs[i], sp + '/properties' + segs[i]) }
        }
      } else for (const k in d) if (names.indexOf(k) === -1 && (p || own(d, k))) { if (e === null) return false; ok = fail(e, 'additionalProperties', ip, sp, { additionalProperty: k }, 'must NOT have additional properties') }
    }
    return ok
  }
}

// A schema that accepts everything.
export const cTrue = () => true

const NONE = /* @__PURE__ */ Object.freeze([])
// The module's exports. `order` sorts the errors where the closures cannot
// produce schema order themselves (a loop over a body that is not a node of
// value checks).
export const cRun = (root, order) => {
  const isValid = (d) => root(d, null, '', '#')
  return {
    isValid,
    isValidObject: isValid,
    validate (d) {
      if (root(d, null, '', '#')) return { valid: true, data: d, errors: NONE }
      const e = []
      root(d, e, '', '#')
      return { valid: false, errors: order ? order(e) : e }
    },
  }
}
