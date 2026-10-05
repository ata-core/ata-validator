'use strict'

const { parse } = require('./safe-regex')

// True when the platform RegExp, a backtracking engine, also runs `src` in
// linear time, so it can take the pattern: every unbounded quantifier on one
// character, class or `.`; at most one of them, and then anchored with `^`;
// a finite repeat may cover a group that holds no unbounded quantifier; few
// bounded choices in all; only escapes both engines read alike; nothing
// outside the BMP, so both see the same UTF-16 units.
// tests/test_regex_native_linear.js holds it.
const NATIVE_ESCAPES = new Set(['d', 'D', 'w', 'W', 's', 'S', 'n', 'r', 't', 'f', 'v', '.', '\\', '/', '^', '$', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}', '-', 'x', 'u'])
function nativeIsLinear (src) {
  if (typeof src !== 'string' || src.length > 512) return false
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdfff) return false
    if (src[i] === '\\') {
      const e = src[i + 1]
      if (!NATIVE_ESCAPES.has(e)) return false
      if (e === 'x' && !/^[0-9a-fA-F]{2}$/.test(src.slice(i + 2, i + 4))) return false
      if (e === 'u' && !/^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) return false
      i++
    }
  }
  let ast
  try { ast = parse(src) } catch { return false }
  // Per subtree: how many unbounded quantifiers it holds (`u`) and how many
  // bounded choices a backtracking engine could try (`b`), or null where the
  // shape is not provably linear. A finite repeat of a group is linear when
  // the group holds no unbounded quantifier: `(?:[A-F0-9]{2}:){31}` has
  // nothing to retry, and its choices multiply through the nesting.
  const atom = (n) => n.t === 'char' || n.t === 'class' || n.t === 'any'
  const info = (n) => {
    switch (n.t) {
      case 'star': case 'plus':
        return atom(n.child) ? { u: 1, b: 0 } : null
      case 'quest': {
        if (atom(n.child)) return { u: 0, b: 1 }
        const c = info(n.child)
        return c === null || c.u > 0 ? null : { u: 0, b: 1 + c.b }
      }
      case 'repeat': {
        if (atom(n.child)) return n.max === Infinity ? { u: 1, b: 0 } : { u: 0, b: n.max - n.min }
        if (n.max === Infinity) return null
        const c = info(n.child)
        return c === null || c.u > 0 ? null : { u: 0, b: (n.max - n.min) + n.max * c.b }
      }
      case 'group': return info(n.child)
      case 'concat': case 'alt': {
        let u = 0, b = 0
        for (const part of (n.t === 'concat' ? n.parts : n.opts)) { const c = info(part); if (c === null) return null; u += c.u; b += c.b }
        return { u, b }
      }
      default: return { u: 0, b: 0 }
    }
  }
  const r = info(ast)
  const ok = r !== null
  const unbounded = ok ? r.u : 0
  const bounded = ok ? r.b : 0
  if (!ok || unbounded > 1 || bounded > 64) return false
  if (unbounded === 1) {
    // Anchored at the start on every top-level branch.
    let top = ast
    while (top.t === 'group') top = top.child
    const branches = top.t === 'alt' ? top.opts : [top]
    const first = (n) => { while (n && n.t === 'group') n = n.child; return n && n.t === 'concat' ? first(n.parts[0]) : n }
    if (!branches.every((b) => { const f = first(b); return f && f.t === 'bol' })) return false
  }
  return true
}

module.exports = { nativeIsLinear }
