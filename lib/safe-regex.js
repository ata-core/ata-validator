'use strict'

// Linear-time regex engine for JSON Schema `pattern`, used in place of JS RegExp
// so an adversarial input cannot trigger catastrophic backtracking (ReDoS).
//
// It is a Pike VM: the pattern compiles to a small instruction program, and the
// VM simulates all NFA threads in lockstep over the input, deduping by program
// counter. Runtime is O(input * program), with no backtracking.
//
// Supported (the RE2 subset, which is what ata's native path also accepts):
// literals, ., character classes, \d \w \s \D \W \S, anchors ^ $, quantifiers
// * + ? {n} {n,} {n,m} (greedy or lazy, same language for a boolean test),
// groups ( ) (?: ), alternation |. Backreferences and lookaround are not
// supported by linear engines; compileSafe throws on them so the caller can
// decide (ata's codegen rejects such schemas rather than risk a hang).

const WS = [[9, 13], [32, 32], [160, 160]]
const DIGIT = [[48, 57]]
const WORD = [[48, 57], [65, 90], [97, 122], [95, 95]]

function parse (src) {
  let i = 0
  const len = src.length
  const peek = () => src[i]
  const eof = () => i >= len

  function parseAlt () {
    const opts = [parseConcat()]
    while (!eof() && peek() === '|') { i++; opts.push(parseConcat()) }
    return opts.length === 1 ? opts[0] : { t: 'alt', opts }
  }

  function parseConcat () {
    const parts = []
    while (!eof() && peek() !== '|' && peek() !== ')') parts.push(parseRepeat())
    if (parts.length === 0) return { t: 'empty' }
    return parts.length === 1 ? parts[0] : { t: 'concat', parts }
  }

  function parseRepeat () {
    let node = parseAtom()
    while (!eof()) {
      const ch = peek()
      if (ch === '*') { i++; node = { t: 'star', child: node } }
      else if (ch === '+') { i++; node = { t: 'plus', child: node } }
      else if (ch === '?') { i++; node = { t: 'quest', child: node } }
      else if (ch === '{') {
        const saved = i
        const q = tryQuantifier()
        if (!q) { i = saved; break }
        node = { t: 'repeat', child: node, min: q.min, max: q.max }
      } else break
      // a trailing ? makes the quantifier lazy; same language for a boolean test
      if (!eof() && peek() === '?') i++
    }
    return node
  }

  function tryQuantifier () {
    // assumes current char is '{'
    i++
    let min = ''
    while (!eof() && /[0-9]/.test(peek())) { min += peek(); i++ }
    if (min === '') return null
    let max
    if (peek() === '}') { i++; return { min: +min, max: +min } }
    if (peek() === ',') {
      i++
      let m = ''
      while (!eof() && /[0-9]/.test(peek())) { m += peek(); i++ }
      if (peek() !== '}') return null
      i++
      max = m === '' ? Infinity : +m
      return { min: +min, max }
    }
    return null
  }

  function parseAtom () {
    const ch = peek()
    if (ch === '(') {
      i++
      if (src[i] === '?') {
        if (src[i + 1] === ':') { i += 2 }
        else throw new Error('unsupported group (lookaround/named) in pattern')
      }
      const child = parseAlt()
      if (peek() !== ')') throw new Error('unbalanced ( in pattern')
      i++
      return { t: 'group', child }
    }
    if (ch === '[') return parseClass()
    if (ch === '.') { i++; return { t: 'any' } }
    if (ch === '^') { i++; return { t: 'bol' } }
    if (ch === '$') { i++; return { t: 'eol' } }
    if (ch === '\\') return parseEscape(false)
    if (ch === ')' || ch === '|') return { t: 'empty' }
    i++
    return { t: 'char', c: ch.charCodeAt(0) }
  }

  function parseClass () {
    i++ // [
    let neg = false
    if (peek() === '^') { neg = true; i++ }
    const ranges = []
    while (!eof() && peek() !== ']') {
      let lo
      if (peek() === '\\') {
        const esc = parseEscape(true)
        if (esc.t === 'classpart') { for (const r of esc.ranges) ranges.push(r); continue }
        lo = esc.c
      } else { lo = peek().charCodeAt(0); i++ }
      if (peek() === '-' && src[i + 1] !== ']' && i + 1 < len) {
        i++ // -
        let hi
        if (peek() === '\\') { const e = parseEscape(true); hi = e.c } else { hi = peek().charCodeAt(0); i++ }
        ranges.push([lo, hi])
      } else {
        ranges.push([lo, lo])
      }
    }
    if (peek() !== ']') throw new Error('unbalanced [ in pattern')
    i++
    return { t: 'class', neg, ranges }
  }

  function parseEscape (inClass) {
    i++ // backslash
    if (eof()) throw new Error('trailing backslash in pattern')
    const ch = peek(); i++
    switch (ch) {
      case 'd': return inClass ? { t: 'classpart', ranges: DIGIT } : { t: 'class', neg: false, ranges: DIGIT }
      case 'w': return inClass ? { t: 'classpart', ranges: WORD } : { t: 'class', neg: false, ranges: WORD }
      case 's': return inClass ? { t: 'classpart', ranges: WS } : { t: 'class', neg: false, ranges: WS }
      case 'D': if (inClass) throw new Error('\\D inside a class is not supported'); return { t: 'class', neg: true, ranges: DIGIT }
      case 'W': if (inClass) throw new Error('\\W inside a class is not supported'); return { t: 'class', neg: true, ranges: WORD }
      case 'S': if (inClass) throw new Error('\\S inside a class is not supported'); return { t: 'class', neg: true, ranges: WS }
      case 'n': return { t: 'char', c: 10 }
      case 'r': return { t: 'char', c: 13 }
      case 't': return { t: 'char', c: 9 }
      case 'f': return { t: 'char', c: 12 }
      case 'v': return { t: 'char', c: 11 }
      case '0': return { t: 'char', c: 0 }
      case 'x': { const h = src.slice(i, i + 2); i += 2; return { t: 'char', c: parseInt(h, 16) } }
      case 'u': { const h = src.slice(i, i + 4); i += 4; return { t: 'char', c: parseInt(h, 16) } }
      case 'b': if (inClass) return { t: 'char', c: 8 }; throw new Error('\\b word boundary is not supported')
      default:
        if (/[1-9]/.test(ch)) throw new Error('backreferences are not supported in pattern')
        return { t: 'char', c: ch.charCodeAt(0) }
    }
  }

  const ast = parseAlt()
  if (!eof()) throw new Error('unexpected "' + peek() + '" in pattern')
  return ast
}

function compileProg (ast) {
  const prog = []
  const emit = (op, extra) => { const idx = prog.length; prog.push(Object.assign({ op }, extra)); return idx }

  function rec (n) {
    switch (n.t) {
      case 'empty': break
      case 'char': emit('char', { c: n.c }); break
      case 'any': emit('any'); break
      case 'class': emit('class', { neg: n.neg, ranges: n.ranges }); break
      case 'bol': emit('bol'); break
      case 'eol': emit('eol'); break
      case 'group': rec(n.child); break
      case 'concat': for (const p of n.parts) rec(p); break
      case 'alt': {
        const jmps = []
        for (let k = 0; k < n.opts.length; k++) {
          if (k < n.opts.length - 1) {
            const sp = emit('split', { x: 0, y: 0 })
            prog[sp].x = prog.length
            rec(n.opts[k])
            jmps.push(emit('jmp', { x: 0 }))
            prog[sp].y = prog.length
          } else {
            rec(n.opts[k])
          }
        }
        for (const j of jmps) prog[j].x = prog.length
        break
      }
      case 'star': {
        const sp = emit('split', { x: 0, y: 0 })
        prog[sp].x = prog.length
        rec(n.child)
        emit('jmp', { x: sp })
        prog[sp].y = prog.length
        break
      }
      case 'plus': {
        const start = prog.length
        rec(n.child)
        const sp = emit('split', { x: start, y: 0 })
        prog[sp].y = prog.length
        break
      }
      case 'quest': {
        const sp = emit('split', { x: 0, y: 0 })
        prog[sp].x = prog.length
        rec(n.child)
        prog[sp].y = prog.length
        break
      }
      case 'repeat': {
        for (let k = 0; k < n.min; k++) rec(n.child)
        if (n.max === Infinity) {
          if (n.min === 0) rec({ t: 'star', child: n.child })
          else rec({ t: 'star', child: n.child })
        } else {
          for (let k = 0; k < n.max - n.min; k++) rec({ t: 'quest', child: n.child })
        }
        break
      }
    }
  }

  rec(ast)
  emit('match')
  return prog
}

// Numeric opcodes for the runner. The program is compiled once into flat
// typed arrays so the inner loop does no property lookups or string compares.
const OP_CHAR = 0
const OP_ANY = 1
const OP_CLASS = 2
const OP_SPLIT = 3
const OP_JMP = 4
const OP_BOL = 5
const OP_EOL = 6
const OP_MATCH = 7

function classMatcher (instr) {
  // ASCII is answered from a bitmap; anything above 0x7f walks the ranges.
  const bits = new Uint8Array(128)
  const r = instr.ranges
  for (let k = 0; k < r.length; k++) {
    const hi = Math.min(r[k][1], 127)
    for (let c = r[k][0]; c <= hi; c++) bits[c] = 1
  }
  return { bits, ranges: r, neg: instr.neg }
}

function matchClass (cls, c) {
  let inside
  if (c < 128) {
    inside = cls.bits[c] === 1
  } else {
    inside = false
    const r = cls.ranges
    for (let k = 0; k < r.length; k++) { if (c >= r[k][0] && c <= r[k][1]) { inside = true; break } }
  }
  return cls.neg ? !inside : inside
}

function makeRunner (prog) {
  const n = prog.length
  const ops = new Uint8Array(n)
  const xs = new Int32Array(n)
  const ys = new Int32Array(n)
  const cs = new Int32Array(n)
  const classes = new Array(n)
  for (let i = 0; i < n; i++) {
    const I = prog[i]
    switch (I.op) {
      case 'char': ops[i] = OP_CHAR; cs[i] = I.c; break
      case 'any': ops[i] = OP_ANY; break
      case 'class': ops[i] = OP_CLASS; classes[i] = classMatcher(I); break
      case 'split': ops[i] = OP_SPLIT; xs[i] = I.x; ys[i] = I.y; break
      case 'jmp': ops[i] = OP_JMP; xs[i] = I.x; break
      case 'bol': ops[i] = OP_BOL; break
      case 'eol': ops[i] = OP_EOL; break
      case 'match': ops[i] = OP_MATCH; break
    }
  }

  const lastGen = new Int32Array(n).fill(-1)
  let gen = 0
  // Each unvisited instruction is popped once and pushes at most two, so the
  // stack never holds more than 2n + 1 entries.
  const stack = new Int32Array(2 * n + 2)
  // Thread lists hold at most one entry per instruction per step.
  let clist = new Int32Array(n)
  let nlist = new Int32Array(n)
  let clen = 0
  let nlen = 0

  // Follows epsilon edges from `pc` and records every consuming instruction
  // (or match) reached in `list`. `lastGen` dedupes per step.
  function addThread (list, len0, pc, pos, len) {
    // Most transitions land directly on a consuming instruction; skip the
    // stack walk for those.
    if (ops[pc] <= OP_CLASS || ops[pc] === OP_MATCH) {
      if (lastGen[pc] === gen) return len0
      lastGen[pc] = gen
      list[len0] = pc
      return len0 + 1
    }
    let sp = 0
    stack[sp++] = pc
    let count = len0
    while (sp > 0) {
      const p = stack[--sp]
      if (lastGen[p] === gen) continue
      lastGen[p] = gen
      switch (ops[p]) {
        case OP_JMP: stack[sp++] = xs[p]; break
        case OP_SPLIT: stack[sp++] = ys[p]; stack[sp++] = xs[p]; break
        case OP_BOL: if (pos === 0) stack[sp++] = p + 1; break
        case OP_EOL: if (pos === len) stack[sp++] = p + 1; break
        default: list[count++] = p
      }
    }
    return count
  }

  // A pattern is anchored when starting it anywhere but position 0 yields no
  // thread, which is the case for `^...` and its alternations. The probe sits
  // at position 1 of a length-1 string so that only `^` can fail. For anchored
  // patterns the per-position restart below is skipped, and an empty thread
  // list means the match has already failed.
  gen++
  const anchored = addThread(nlist, 0, 0, 1, 1) === 0

  return function test (s) {
    const len = s.length
    gen++
    clen = addThread(clist, 0, 0, 0, len)
    for (let pos = 0; pos <= len; pos++) {
      const c = pos < len ? s.charCodeAt(pos) : -1
      gen++
      nlen = 0
      for (let k = 0; k < clen; k++) {
        const pc = clist[k]
        switch (ops[pc]) {
          case OP_MATCH: return true
          case OP_CHAR: if (c === cs[pc]) nlen = addThread(nlist, nlen, pc + 1, pos + 1, len); break
          case OP_ANY: if (c !== -1 && c !== 10) nlen = addThread(nlist, nlen, pc + 1, pos + 1, len); break
          case OP_CLASS: if (c !== -1 && matchClass(classes[pc], c)) nlen = addThread(nlist, nlen, pc + 1, pos + 1, len); break
        }
      }
      if (pos < len) {
        if (!anchored) nlen = addThread(nlist, nlen, 0, pos + 1, len)
        else if (nlen === 0) return false
      }
      const tmp = clist; clist = nlist; nlist = tmp
      clen = nlen
    }
    return false
  }
}

function compileSafe (pattern) {
  const prog = compileProg(parse(pattern))
  const runner = makeRunner(prog)
  // `__ataSafe` brands the result so the standalone serializer can tell a safe
  // matcher apart from a RegExp and emit `__ataSafeRe(source)` instead.
  return { test: runner, source: pattern, __ataSafe: true }
}

// True when the linear engine can represent `src`. Used by the codegen to decide
// between the safe matcher and a JS RegExp fallback for patterns outside the
// supported (RE2) subset (backreferences, lookaround, etc.).
function patternIsSafe (src) {
  try { compileSafe(src); return true } catch { return false }
}

module.exports = { compileSafe, patternIsSafe }
