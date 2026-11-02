// the helpers every keyword kernel shares, one export each so a bundle
// keeps only what its kernels call. Each mirrors the function named beside it
// in lib/, output for output; tests/test_ir_differential.mjs holds them to
// the current engine.

const hop = Object.prototype.hasOwnProperty
export const own = (o, k) => hop.call(o, k)
export const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

// lib/js-compiler.js _cpLen: code points, a lone surrogate counting as one.
export function cpLen (s) {
  const n = s.length
  for (let i = 0; i < n; i++) {
    if (((s.charCodeAt(i) - 0xD800) >>> 0) < 0x800) { let c = 0; for (const _ of s) c++; return c }
  }
  return n
}

// lib/enrich-error.js jsonSizeWithin and reprValue, without the per-run count
// cache, which changes the time a wide object takes and not the text.
function sizeWithin (v, b) {
  if (b < 0) return -1
  if (v === null) return 4
  const t = typeof v
  if (t === 'number') return Number.isFinite(v) ? String(v).length : 4
  if (t === 'boolean') return v ? 4 : 5
  if (t === 'string') return v.length + 2 > b ? -1 : v.length + 2
  if (t !== 'object') return -1
  if (typeof v.toJSON === 'function') return 2
  let n = 2
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      n += i === 0 ? 0 : 1
      if (n > b) return -1
      const c = sizeWithin(v[i], b - n)
      if (c < 0 || (n += c) > b) return -1
    }
    return n
  }
  const p = Object.getPrototypeOf(v)
  if (p !== Object.prototype && p !== null) return -1
  let first = true
  for (const k in v) {
    const x = v[k]
    if (x === undefined || typeof x === 'function' || typeof x === 'symbol') continue
    n += k.length + 3 + (first ? 0 : 1)
    if (n > b) return -1
    first = false
    const c = sizeWithin(x, b - n)
    if (c < 0 || (n += c) > b) return -1
  }
  return n
}

export function repr (v) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  const t = typeof v
  if (t === 'string') { const s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '..."' : s }
  if (t === 'number' || t === 'boolean') return String(v)
  if (Array.isArray(v)) return `[array, ${v.length} items]`
  if (t === 'object') {
    let n
    try { n = Object.keys(v).length } catch { return '[object, unserializable]' }
    if (n <= 12 && sizeWithin(v, 60) >= 0) {
      try { const s = JSON.stringify(v); if (s !== undefined && s.length <= 60) return s } catch { return '[object, unserializable]' }
    }
    return `[object, ${n} ${n === 1 ? 'key' : 'keys'}]`
  }
  return `[${t}]`
}

// The value an error names when the enrichment has none to show.
export const MISSING = Symbol('missing')

// lib/enrich-error.js typeNameOfValue, then typeNameOf on the repr.
export function typeName (v, received) {
  if (v !== MISSING) {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'boolean': return 'boolean'
      case 'string': return 'string'
      case 'number': return Number.isFinite(v) ? 'number' : 'value'
      case 'object': if (Array.isArray(v)) return 'array'; if (typeof v.toJSON !== 'function') return 'object'; break
      default: return 'value'
    }
  }
  if (received === undefined) return 'nothing'
  if (received === 'null') return 'null'
  if (received === 'true' || received === 'false') return 'boolean'
  if (received.startsWith('"')) return 'string'
  if (received.startsWith('[array')) return 'array'
  if (received.startsWith('{') || received.startsWith('[object')) return 'object'
  if (/^-?\d/.test(received)) return 'number'
  return 'value'
}

// lib/levenshtein.js: optimal string alignment distance (a swap is one edit),
// bounded: past `max` the answer is Infinity. Only the cells within the bound
// of the diagonal are computed, on three rows of scratch reused across calls,
// reading characters by code: a full matrix of fresh arrays and one-character
// strings was 90% of a rejected document's time on a schema whose objects
// have many keys (codex-plugin-manifest).
let rowA = new Int32Array(64); let rowB = new Int32Array(64); let rowC = new Int32Array(64)
export function osa (a, b, max) {
  if (a === b) return 0
  const n = a.length; const m = b.length
  if (max === undefined || max > n + m) max = n + m
  if (Math.abs(n - m) > max) return Infinity
  if (n === 0) return m
  if (m === 0) return n
  const big = max + 1
  if (rowA.length < m + 2) { rowA = new Int32Array(m + 2); rowB = new Int32Array(m + 2); rowC = new Int32Array(m + 2) }
  let prev2 = rowC; let prev = rowA; let curr = rowB
  for (let j = 0; j <= m; j++) prev[j] = j <= max ? j : big
  for (let i = 1; i <= n; i++) {
    const lo = i - max > 1 ? i - max : 1
    const hi = i + max < m ? i + max : m
    curr[lo - 1] = lo === 1 ? i : big
    let rowMin = curr[lo - 1]
    const ca = a.charCodeAt(i - 1)
    const pa = i > 1 ? a.charCodeAt(i - 2) : -1
    for (let j = lo; j <= hi; j++) {
      const cb = b.charCodeAt(j - 1)
      let v = prev[j - 1] + (ca === cb ? 0 : 1)
      const del = curr[j - 1] + 1
      if (del < v) v = del
      const ins = prev[j] + 1
      if (ins < v) v = ins
      if (j > 1 && ca !== cb && ca === b.charCodeAt(j - 2) && pa === cb) {
        const swap = prev2[j - 2] + 1
        if (swap < v) v = swap
      }
      if (v > big) v = big
      curr[j] = v
      if (v < rowMin) rowMin = v
    }
    if (hi < m) curr[hi + 1] = big
    if (rowMin > max) return Infinity
    const t = prev2; prev2 = prev; prev = curr; curr = t
  }
  return prev[m] > max ? Infinity : prev[m]
}

// lib/suggestions.js nearest with its typo budget.
export function nearest (target, candidates) {
  const n = target.length
  const budget = n < 3 ? 0 : n < 5 ? 1 : 2
  let best = null; let bestD = budget + 1; let tied = false
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    if (Math.abs(c.length - n) > budget) continue
    const d = osa(target, c, budget)
    if (d === 0 || d > budget) continue
    if (d < bestD) { best = c; bestD = d; tied = false } else if (d === bestD) tied = true
  }
  return tied ? null : best
}

const DOC = 'https://ata-validator.com/e/'

// One error in the order and shape lib/enrich-error.js enrich() writes them.
// `seen` is false when the root value is one the enrichment treats as absent
// (a falsy root other than 0 and false): then nothing is received.
export function E (code, keyword, path, schemaPath, params, message, expected, rank, v, seen, detail, suggest, branchErrors) {
  const received = seen ? repr(v) : undefined
  const o = { code, message, keyword, path, expected, received, schemaPath, docUrl: DOC + code, instancePath: path, dataPath: path, params, parentSchema: undefined }
  if (branchErrors) o.branchErrors = branchErrors
  const at = seen ? v : MISSING
  const s = suggest ? suggest(at, params) : null
  if (s) o.suggestion = s
  const d = detail ? detail(received, at, params) : (expected === undefined ? undefined : `expected ${expected}, found ${received}`)
  if (d !== undefined) o.detail = d
  o.rank = rank
  return o
}

// lib/correlate.js correlateTypos, applied as lib/rejections.js attachRelated
// does: a required error and an additionalProperties error in one container
// whose names are one unambiguous typo apart point at each other.
const far = (a, b) => osa(a, b, 2)
export function relate (errors) {
  let m = false; let x = false
  for (const e of errors) { if (e.keyword === 'required') m = true; else if (e.keyword === 'additionalProperties') x = true }
  if (!m || !x) return errors
  const byPath = new Map()
  errors.forEach((e, i) => {
    const miss = e.keyword === 'required' ? e.params.missingProperty : undefined
    const extra = e.keyword === 'additionalProperties' ? e.params.additionalProperty : undefined
    if (typeof miss !== 'string' && typeof extra !== 'string') return
    let b = byPath.get(e.instancePath)
    if (!b) byPath.set(e.instancePath, b = { miss: [], extra: [] })
    if (typeof miss === 'string') b.miss.push([i, miss]); else b.extra.push([i, extra])
  })
  for (const b of byPath.values()) {
    if (!b.miss.length || !b.extra.length) continue
    const dist = b.miss.map(([, a]) => b.extra.map(([, c]) => far(a, c)))
    for (let mi = 0; mi < b.miss.length; mi++) {
      let bx = -1; let bd = Infinity; let tied = false
      for (let xi = 0; xi < b.extra.length; xi++) { const d = dist[mi][xi]; if (d < bd) { bd = d; bx = xi; tied = false } else if (d === bd && d !== Infinity) tied = true }
      if (bx === -1 || tied || !(bd > 0 && bd <= 2)) continue
      let bm = -1; let bk = Infinity; let btied = false
      for (let m2 = 0; m2 < b.miss.length; m2++) { const d = dist[m2][bx]; if (d < bk) { bk = d; bm = m2; btied = false } else if (d === bk && d !== Infinity) btied = true }
      if (btied || bm !== mi) continue
      const a = errors[b.miss[mi][0]]; const c = errors[b.extra[bx][0]]
      ;(a.related || (a.related = [])).includes(b.extra[bx][0]) || a.related.push(b.extra[bx][0])
      ;(c.related || (c.related = [])).includes(b.miss[mi][0]) || c.related.push(b.miss[mi][0])
    }
  }
  return errors
}

// Own keys in the order the current engine reports additional properties:
// insertion order, with an own "__proto__" (JSON.parse makes one) last.
export function keysOf (v) {
  const k = Object.keys(v)
  const i = k.indexOf('__proto__')
  if (i !== -1) { k.splice(i, 1); k.push('__proto__') }
  return k
}

export const seg = (k) => k.replace(/~/g, '~0').replace(/\//g, '~1')

// What a schema evaluated at one instance location: property names, and for
// arrays a prefix length, single indices (contains) or everything. The two
// sets are made on the first name or index written: most collectors take
// none (a branch that fails, an object with no listed names), and making
// two Sets for each was most of a verdict's time on a schema built on
// unevaluatedProperties (yamllint).
export const newAnn = () => ({ p: null, n: 0, at: null, all: false })
export function mergeAnn (into, from) {
  if (from.p !== null) { if (into.p === null) into.p = new Set(from.p); else for (const k of from.p) into.p.add(k) }
  if (from.n > into.n) into.n = from.n
  if (from.at !== null) { if (into.at === null) into.at = new Set(from.at); else for (const i of from.at) into.at.add(i) }
  if (from.all) into.all = true
}

// The first index unevaluatedItems reports: past the evaluated prefix and
// the single indices contains matched.
export function firstUneval (A, x) { let j = A.n; if (A.at !== null) while (j < x.length && A.at.has(j)) j++; return j }

// lib/defaults.js setOwn and copyOf: write an own property (a key named
// __proto__ through defineProperty, so it never reaches the prototype), and
// a fresh copy of a default for each value it fills.
export function setOwn (o, k, v) {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true })
  else o[k] = v
}
export const copyOf = (v) => typeof v !== 'object' || v === null ? v : Array.isArray(v) && v.length === 0 ? [] : JSON.parse(JSON.stringify(v))
