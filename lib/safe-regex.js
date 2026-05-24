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

function matchClass (instr, c) {
  let inside = false
  const r = instr.ranges
  for (let k = 0; k < r.length; k++) { if (c >= r[k][0] && c <= r[k][1]) { inside = true; break } }
  return instr.neg ? !inside : inside
}

function makeRunner (prog) {
  const n = prog.length
  const lastGen = new Int32Array(n).fill(-1)
  let gen = 0
  const stack = []

  function addThread (list, pc, pos, len) {
    stack.length = 0
    stack.push(pc)
    while (stack.length) {
      const p = stack.pop()
      if (lastGen[p] === gen) continue
      lastGen[p] = gen
      const I = prog[p]
      switch (I.op) {
        case 'jmp': stack.push(I.x); break
        case 'split': stack.push(I.y); stack.push(I.x); break
        case 'bol': if (pos === 0) stack.push(p + 1); break
        case 'eol': if (pos === len) stack.push(p + 1); break
        default: list.push(p)
      }
    }
  }

  return function test (s) {
    const len = s.length
    let clist = []
    let nlist = []
    gen++
    addThread(clist, 0, 0, len)
    for (let pos = 0; pos <= len; pos++) {
      const c = pos < len ? s.charCodeAt(pos) : -1
      gen++
      nlist.length = 0
      for (let k = 0; k < clist.length; k++) {
        const pc = clist[k]
        const I = prog[pc]
        if (I.op === 'match') return true
        else if (I.op === 'char') { if (c === I.c) addThread(nlist, pc + 1, pos + 1, len) }
        else if (I.op === 'any') { if (c !== -1 && c !== 10) addThread(nlist, pc + 1, pos + 1, len) }
        else if (I.op === 'class') { if (c !== -1 && matchClass(I, c)) addThread(nlist, pc + 1, pos + 1, len) }
      }
      if (pos < len) addThread(nlist, 0, pos + 1, len)
      const tmp = clist; clist = nlist; nlist = tmp
    }
    return false
  }
}

function compileSafe (pattern) {
  const prog = compileProg(parse(pattern))
  const runner = makeRunner(prog)
  return { test: runner, source: pattern }
}

// True when the linear engine can represent `src`. Used by the codegen to decide
// between the safe matcher and a JS RegExp fallback for patterns outside the
// supported (RE2) subset (backreferences, lookaround, etc.).
function patternIsSafe (src) {
  try { compileSafe(src); return true } catch { return false }
}

module.exports = { compileSafe, patternIsSafe }
