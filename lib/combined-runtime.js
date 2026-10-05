'use strict'

// What the one-pass (combined) function needs at run time and does not need
// a copy of: one module-level implementation each, handed to every compiled
// program as a closure value. Each program used to carry its own copy of
// these in its source, so a thousand validators meant a thousand `_ap`s, a
// thousand `__ataCollapse`s and so on, each parsed, each compiled by the
// baseline compiler, each queued for the optimizing compiler on its own.
// On the official suite, with about a thousand validators in one process,
// the optimizing compiler got to 728 functions in five seconds, and the
// validators themselves (`_vC`) were 242 of those. Shared, a helper is
// compiled once and is hot from the second validator on. The generated
// standalone modules (lib/aot-impl.js) are not built from this generator and
// keep their own embedded copies.

// The error list's order, kept as it grows (see apOrd in lib/js-compiler.js):
// `os` the ordinal of each error in push order, `mo` whether they are still in
// order, `lo` the last ordinal. One state per compiled program, reset at the
// top of each call.
function apState () { return { mo: true, lo: -1, on: 0, os: [] } }

// Append one error. Two errors with the same ordinal are in order only when
// they share a path (the items of one array, say); with different paths their
// order is the rank of the paths, which the reader works out.
function ap (S, e, x, o) {
  if (o < 0 || o < S.lo || (o === S.lo && (e === undefined || x.schemaPath !== e[e.length - 1].schemaPath))) S.mo = false
  else S.lo = o
  S.os[S.on++] = o
  if (e === undefined) return [x]
  e.push(x)
  return e
}

// Put a list that did not come in order into order by the ordinals collected
// beside it: a stable insertion sort over a few integers. The reader's sort
// (`srt`) still answers where a key is unknown (-1), where two errors share a
// key but not a path, and for long lists.
function sr (S, e, srt) {
  const n = e.length
  const os = S.os
  if (n > 16 || n !== S.on) return srt(e)
  for (let i = 0; i < n; i++) {
    if (os[i] < 0) return srt(e)
    // A collapsed branch error carries the closest branch's errors, which
    // the reader puts in schema order too; one error needs no ordering.
    const b = e[i].branchErrors
    if (b !== undefined && b.length > 1) return srt(e)
    for (let j = 0; j < i; j++) if (os[j] === os[i] && e[j].schemaPath !== e[i].schemaPath) return srt(e)
  }
  for (let i = 1; i < n; i++) {
    const k = os[i]
    const x = e[i]
    let j = i - 1
    while (j >= 0 && os[j] > k) { os[j + 1] = os[j]; e[j + 1] = e[j]; j-- }
    os[j + 1] = k
    e[j + 1] = x
  }
  return e
}

// `sr` checked against the reader's order on every list; the test suites run
// the generator with ATA_CHECK_SORT set, which routes here.
function srX (S, e, srt) {
  const c = e.slice()
  const k = S.os.slice(0, S.on)
  const a = sr(S, e, srt)
  const b = srt(c)
  if (a.length !== b.length || a.some((x, i) => x.schemaPath !== b[i].schemaPath || x.instancePath !== b[i].instancePath)) {
    throw new Error('ata: local error sort disagrees with the reader ' + JSON.stringify(a.map((x) => x.schemaPath)) + ' vs ' + JSON.stringify(b.map((x) => x.schemaPath)) + ' keys ' + JSON.stringify(k))
  }
  return a
}

// Presence helpers (see OWN_HELPER_CODE in lib/js-compiler.js for the text
// the standalone modules carry). The prototype test itself stays inline in
// the generated code, read once per object: a shared helper reading the
// prototype of every object it was asked about was megamorphic.
const _PN = ({}).__proto__ === Object.prototype // eslint-disable-line no-proto
const _OP = Object.prototype
const _gp = Object.getPrototypeOf
const _hop = Object.prototype.hasOwnProperty
function _h (o, k) { return _hop.call(o, k) }
function _ok (o, k) { return (_PN ? o.__proto__ : _gp(o)) === _OP || _hop.call(o, k) } // eslint-disable-line no-proto
function _hall (o, ks) { for (let i = 0; i < ks.length; i++) if (!_hop.call(o, ks[i])) return false; return true }

// RFC 6901 escaping for a key only known at run time (the static ones are
// escaped when the code is written).
function _pe (s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 126 || c === 47) return s.replace(/~/g, '~0').replace(/\//g, '~1')
  }
  return s
}

// The annotation functions' constants (emitAnnot): the boolean schemas, and
// the rollback of the evaluated-name list when a branch fails.
function _anT () { return true }
function _anF () { return false }
function _rb (S, m) { if (S.length !== m) S.length = m }

module.exports = {
  apState, ap, sr, srX,
  _PN, _OP, _gp, _hop, _h, _ok, _hall, _pe, _anT, _anF, _rb,
}
// Loaded when a program first asks for them: a schema without const, enum,
// uniqueItems, oneOf or anyOf never needs these modules on its cold path.
Object.defineProperty(module.exports, '_deq', { enumerable: true, get () { return require('./unique-items')._deq } })
Object.defineProperty(module.exports, '__ataCollapse', { enumerable: true, get () { return require('./branch-collapse')._collapse } })
Object.defineProperty(module.exports, '__ataMulti', { enumerable: true, get () { return require('./branch-collapse')._multi } })
