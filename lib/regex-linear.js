'use strict'

const { parse } = require('./safe-regex')

// True when a backtracking engine, the platform RegExp, runs `src` in time
// linear in the input as well, so the pattern can be handed to it: faster than
// this engine, and a compiled module that uses only such patterns does not
// have to carry this engine at all. Deliberately narrow:
//   - every quantifier applies to one character, class or `.`, never to a
//     group, so no quantifier can make a nested one retry;
//   - at most one quantifier is unbounded, and then the pattern is anchored at
//     its start, so a failed match is not retried from every position;
//   - the bounded quantifiers allow few choices in total;
//   - only escapes both engines read the same way, and no character outside
//     the BMP, since this engine and a RegExp without the `u` flag both see
//     UTF-16 code units, which is what makes their answers the same.
// tests/test_regex_native_linear.js holds this engine and the RegExp to the
// same answers on every pattern this accepts.
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
  let unbounded = 0
  let bounded = 0
  let ok = true
  const atom = (n) => n.t === 'char' || n.t === 'class' || n.t === 'any'
  const walk = (n) => {
    if (!ok) return
    switch (n.t) {
      case 'star': case 'plus':
        if (!atom(n.child)) ok = false
        unbounded++
        break
      case 'quest':
        if (!atom(n.child)) ok = false
        bounded += 1
        break
      case 'repeat':
        if (!atom(n.child)) ok = false
        if (n.max === Infinity) unbounded++
        else bounded += n.max - n.min
        break
      case 'group': walk(n.child); break
      case 'concat': n.parts.forEach(walk); break
      case 'alt': n.opts.forEach(walk); break
      default: break
    }
  }
  walk(ast)
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
