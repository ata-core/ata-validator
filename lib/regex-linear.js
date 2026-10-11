'use strict'

const { parse } = require('./safe-regex')

// True when the platform RegExp, a backtracking engine, also runs `src` in
// linear time, so it can take the pattern instead of the linear-time engine
// in safe-regex.js, which costs three to five times as much per character.
// Two rules, and a pattern passes on either:
//
// The simple rule, the original one: every unbounded quantifier is on one
// character, class or `.`; at most one of them, and then the pattern is
// anchored with `^` on every branch; a finite repeat may cover a group that
// holds no unbounded quantifier; few bounded choices in all. One loop whose
// body cannot be split two ways, exited at most once per position, with
// bounded work after it.
//
// The deterministic rule, for the patterns the simple one declines: dotted
// identifiers, `[^/]+/[^/]+`, version numbers. On the Glushkov construction
// the characters, classes and dots are positions. Around every unbounded
// loop the next character must decide the single way to continue: the
// positions that can follow a position inside a loop accept pairwise
// disjoint characters, and so do the positions a match can start at when a
// loop is among them; a position reaches a follower by one route only, since
// `(a+)+` reaches `a` from `a` through the inner loop and again through the
// outer one and that double route is what a backtracking engine explores
// exponentially; a loop body must not match the empty string, since `(a*)*`
// iterates emptily without bound. Ambiguity away from any loop, `(pwa|PWA)`,
// costs a bounded factor and is allowed, as the simple rule allows it. A
// bounded repeat is a loop only when its body holds an unbounded one, since
// `(\w+\s?){5}` splits five ways where `(?:[A-F0-9]{2}:){31}` counts. With
// an unbounded quantifier the pattern must be anchored with `^` on every
// branch, since an unanchored search retries from each position.
//
// Both rules allow only escapes both engines read alike and nothing outside
// the BMP, so both see the same UTF-16 units. tests/test_regex_native_linear.js
// holds them: every accepted pattern answers as the linear engine does and
// stays fast on inputs built to make a backtracking engine retry.
const NATIVE_ESCAPES = new Set(['d', 'D', 'w', 'W', 's', 'S', 'n', 'r', 't', 'f', 'v', '.', '\\', '/', '^', '$', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}', '-', 'x', 'u'])
const MAX_BOUNDED_CHOICES = 64

const atom = (n) => n.t === 'char' || n.t === 'class' || n.t === 'any'

// Anchored at the start on every top-level branch.
function anchored (ast) {
  let top = ast
  while (top.t === 'group') top = top.child
  const branches = top.t === 'alt' ? top.opts : [top]
  const first = (n) => { while (n && n.t === 'group') n = n.child; return n && n.t === 'concat' ? first(n.parts[0]) : n }
  return branches.every((b) => { const f = first(b); return f && f.t === 'bol' })
}

function simpleRule (ast) {
  // Per subtree: how many unbounded quantifiers it holds (`u`) and how many
  // bounded choices a backtracking engine could try (`b`), or null where the
  // shape is not provably linear.
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
  if (r === null || r.u > 1 || r.b > MAX_BOUNDED_CHOICES) return false
  return r.u === 0 || anchored(ast)
}

// The characters a position accepts: 128 ASCII bits and one bit for "some
// code point at 128 or above", which keeps two classes with non-ASCII
// members apart only when one of them has none. Conservative in the right
// direction: an overlap that is not there only sends a pattern to the
// linear engine.
function charSet (node) {
  const bits = new Uint8Array(128)
  let high = 0
  if (node.t === 'any') {
    bits.fill(1); bits[10] = 0; bits[13] = 0; high = 1
  } else if (node.t === 'char') {
    if (node.c < 128) bits[node.c] = 1; else high = 1
  } else {
    for (const [lo, hi] of node.ranges) {
      for (let c = Math.max(0, lo), top = Math.min(127, hi); c <= top; c++) bits[c] = 1
      if (hi >= 128) high = 1
    }
    if (node.neg) { for (let c = 0; c < 128; c++) bits[c] ^= 1; high = 1 }
  }
  return { bits, high }
}

function overlap (a, b) {
  if (a.high && b.high) return true
  for (let c = 0; c < 128; c++) if (a.bits[c] & b.bits[c]) return true
  return false
}

// Whether a subtree holds an unbounded quantifier.
function hasUnbounded (n) {
  switch (n.t) {
    case 'star': case 'plus': return true
    case 'repeat': return n.max === Infinity || hasUnbounded(n.child)
    case 'quest': case 'group': return hasUnbounded(n.child)
    case 'concat': return n.parts.some(hasUnbounded)
    case 'alt': return n.opts.some(hasUnbounded)
    default: return false
  }
}

function deterministicRule (ast) {
  const sets = []
  const follow = []
  const inLoop = []
  let ok = true
  let unbounded = 0
  let bounded = 0
  let depth = 0
  // Pairwise disjoint, required when a loop position is among them.
  const disjoint = (ids) => {
    const arr = Array.from(ids)
    if (!arr.some((p) => inLoop[p])) return
    for (let i = 0; i < arr.length && ok; i++) {
      for (let j = i + 1; j < arr.length; j++) if (overlap(sets[arr[i]], sets[arr[j]])) { ok = false; return }
    }
  }
  const link = (from, to) => {
    for (const p of to) {
      if (follow[from].has(p)) { ok = false; return }
      follow[from].add(p)
    }
  }
  const empty = () => ({ nullable: true, first: new Set(), last: new Set() })
  const walk = (n) => {
    if (!ok) return empty()
    switch (n.t) {
      case 'char': case 'class': case 'any': {
        const id = sets.length
        sets.push(charSet(n))
        follow.push(new Set())
        inLoop.push(depth > 0)
        return { nullable: false, first: new Set([id]), last: new Set([id]) }
      }
      case 'bol': case 'eol': return empty()
      case 'group': return walk(n.child)
      case 'star': case 'plus': case 'quest': case 'repeat': {
        const infinite = n.t === 'star' || n.t === 'plus' || (n.t === 'repeat' && n.max === Infinity)
        const loops = infinite || (n.t === 'repeat' && n.max > 1 && hasUnbounded(n.child))
        const optional = n.t === 'star' || n.t === 'quest' || (n.t === 'repeat' && n.min === 0)
        if (loops) depth++
        const c = walk(n.child)
        if (loops) depth--
        if (infinite) {
          unbounded++
          if (c.nullable) ok = false
        } else if (n.t === 'quest') {
          bounded += 1
        } else {
          bounded += (n.max - n.min)
          if (!atom(n.child)) bounded += n.max
        }
        if (loops) for (const l of c.last) link(l, c.first)
        return { nullable: c.nullable || optional, first: c.first, last: c.last }
      }
      case 'concat': {
        let acc = empty()
        for (const part of n.parts) {
          const r = walk(part)
          for (const l of acc.last) link(l, r.first)
          const first = new Set(acc.first)
          if (acc.nullable) for (const f of r.first) first.add(f)
          const last = new Set(r.last)
          if (r.nullable) for (const l of acc.last) last.add(l)
          acc = { nullable: acc.nullable && r.nullable, first, last }
        }
        return acc
      }
      case 'alt': {
        const rs = n.opts.map(walk)
        const first = new Set()
        const last = new Set()
        for (const r of rs) { for (const f of r.first) first.add(f); for (const l of r.last) last.add(l) }
        return { nullable: rs.some((r) => r.nullable), first, last }
      }
      default:
        ok = false
        return empty()
    }
  }
  const root = walk(ast)
  if (!ok) return false
  disjoint(root.first)
  for (let p = 0; p < sets.length && ok; p++) disjoint(follow[p])
  if (!ok) return false
  if (bounded > MAX_BOUNDED_CHOICES) return false
  return unbounded === 0 || anchored(ast)
}

// Two more shapes the rules above decline, both anchored with `^` and `$`
// around one top-level sequence.
//
// One choice: characters and classes, each repeated a fixed or bounded number
// of times, with only one of the repeats able to vary, by at most 256
// (`^[a-z0-9_-]{1,128}$`).
// The engine backtracks through that one repeat and nowhere else, at most its
// width per attempt, and the anchor allows one attempt.
//
// A delimited loop: `^P(Xd)*Q$` or with `+`, where d is one character or
// class, X and Q match nothing d matches (Q may end with d, or an optional
// d), and P holds no unbounded quantifier. Dotted identifiers and paths are
// written so: `^([A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*$`, `^/?([^/]+/)*[^/]+/?$`.
// Every iteration and Q's match end at a d or at the end, so each wrong
// choice between another iteration and Q fails within one segment, and the
// segments together are the input once. X and Q each hold at most one
// unbounded quantifier, over a character or class, so a segment is not split
// two ways either.
function sequenceOf (ast) {
  if (ast.t !== 'concat') return null
  const parts = ast.parts
  if (parts.length < 3 || parts[0].t !== 'bol' || parts[parts.length - 1].t !== 'eol') return null
  return parts.slice(1, -1)
}
const repeatOfAtom = (n) => (n.t === 'star' || n.t === 'plus' || n.t === 'quest' || n.t === 'repeat') && atom(n.child)
const unboundedNode = (n) => n.t === 'star' || n.t === 'plus' || (n.t === 'repeat' && n.max === Infinity)

function oneChoiceRule (ast) {
  const seq = sequenceOf(ast)
  if (seq === null) return false
  let varying = 0
  for (const n of seq) {
    if (atom(n)) continue
    if (n.t === 'repeat' && atom(n.child) && n.max !== Infinity) {
      if (n.max > 256) return false
      if (n.max > n.min) varying++
      continue
    }
    return false
  }
  return varying <= 1
}

function delimitedLoopRule (ast) {
  const seq = sequenceOf(ast)
  if (seq === null) return false
  const loopAt = seq.findIndex((n) => unboundedNode(n) && !atom(n.child))
  if (loopAt < 0) return false
  let body = seq[loopAt].child
  while (body.t === 'group') body = body.child
  if (body.t !== 'concat' || body.parts.length < 2) return false
  const d = body.parts[body.parts.length - 1]
  if (!atom(d)) return false
  const D = charSet(d)
  // A run of characters, classes and their repeats that matches nothing in
  // D, with at most one unbounded quantifier.
  const run = (nodes) => {
    let unbounded = 0
    for (const n of nodes) {
      const a = atom(n) ? n : repeatOfAtom(n) ? n.child : null
      if (a === null || overlap(charSet(a), D)) return false
      if (unboundedNode(n)) unbounded++
      if (n.t === 'repeat' && n.max !== Infinity && n.max - n.min > 64) return false
    }
    return unbounded <= 1
  }
  if (!run(body.parts.slice(0, -1))) return false
  const prefix = seq.slice(0, loopAt)
  if (prefix.some(hasUnbounded)) return false
  const pb = simpleRule({ t: 'concat', parts: prefix })
  if (!pb && prefix.length > 0) return false
  let suffix = seq.slice(loopAt + 1)
  const last = suffix[suffix.length - 1]
  if (last !== undefined) {
    const tail = atom(last) ? last : last.t === 'quest' && atom(last.child) ? last.child : null
    if (tail !== null && !overlap(charSet(tail), { bits: D.bits.map((b) => b ^ 1), high: D.high ? 0 : 1 })) suffix = suffix.slice(0, -1)
  }
  return run(suffix)
}

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
  return simpleRule(ast) || deterministicRule(ast) || oneChoiceRule(ast) || delimitedLoopRule(ast)
}

module.exports = { nativeIsLinear }
