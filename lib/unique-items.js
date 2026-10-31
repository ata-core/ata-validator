'use strict';

// uniqueItems for every engine. These are real functions: the interpreted
// engine calls them, and the code generator emits their source text
// (`String(fn)`) into the function it builds, so both run the same code.
// They read only each other, `_deq` and `_uqpI`, which the generator emits
// beside them.
//
// Short arrays compare pairwise and allocate nothing. Longer arrays of
// primitives key a Set or Map by the value itself. Longer arrays that hold an
// object key a Map by a numeric structural hash, and only items whose hashes
// collide are compared with `_deq`. Equal values always hash alike: numbers
// by their bits, with 0 and -0 as one (1 and 1.0 are one double already),
// strings by their characters, arrays by position, and objects by the sum of their own key-value hashes,
// whatever the key order. The hash replaced a sorted-key canonical string
// built for every item on every call, which was over a quarter of the time a
// generated verdict spent on SchemaStore's sample documents.

// JSON equality, the same function the generator hoists as DEQ_HELPER.
function _deq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  var aa = Array.isArray(a);
  if (aa !== Array.isArray(b)) return false;
  var i, k, x, y;
  if (aa) {
    if (a.length !== b.length) return false;
    for (i = a.length; i-- !== 0;) if (!_deq(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  // Keys and scalar values first, nested values after, from the last key back:
  // two items of a list most often differ in a name, a path or an id, and
  // walking a nested list first made each comparison of rust-project's crates
  // three times what it needed (250 against 78 ns for the three; the default
  // validator's deep equal takes 115).
  for (i = ka.length; i-- !== 0;) {
    k = ka[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    x = a[k]; y = b[k];
    if (x !== y && (x === null || y === null || typeof x !== 'object' || typeof y !== 'object')) return false;
  }
  for (i = ka.length; i-- !== 0;) {
    k = ka[i]; x = a[k];
    if (x !== null && typeof x === 'object' && !_deq(x, b[k])) return false;
  }
  return true;
}

function _uqh(x) {
  if (x === null) return 1;
  var t = typeof x, h, i;
  if (t === 'boolean') return x ? 2 : 3;
  if (t === 'number') {
    if (x === 0) return 4;
    h = x | 0;
    if (h === x) return Math.imul(h, 0x9e3779b1) ^ 5;
    // Every bit of the number goes into the hash, read through a typed
    // array kept on the function (its source is emitted into modules, so
    // nothing outside it is read). Nine decimal places, which this used to
    // keep, hashed every number below 1e-9 alike, and an array of them was
    // compared item against item.
    var f = _uqh.f || (_uqh.f = new Float64Array(1)), w = _uqh.w || (_uqh.w = new Uint32Array(f.buffer));
    f[0] = x;
    return Math.imul(w[0] ^ Math.imul(w[1], 0x9e3779b1), 0x85ebca6b) ^ 5;
  }
  if (t === 'string') {
    h = 0x811c9dc5 ^ x.length;
    for (i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
    return h;
  }
  if (t !== 'object') return 6;
  if (Array.isArray(x)) {
    h = 0x2545f491 ^ x.length;
    for (i = 0; i < x.length; i++) h = Math.imul(h ^ _uqh(x[i]), 16777619);
    return h;
  }
  var ks = Object.keys(x);
  h = 0x6c8e9cf5 ^ ks.length;
  for (i = 0; i < ks.length; i++) h = (h + Math.imul(_uqh(ks[i]) ^ Math.imul(_uqh(x[ks[i]]), 0x5bd1e995), 0x27d4eb2d)) | 0;
  return h;
}

// Whether every item is distinct.
function _uq(a) {
  var n = a.length, i, k;
  if (n < 2) return true;
  if (n <= 12) {
    for (i = 1; i < n; i++) for (k = 0; k < i; k++) if (_deq(a[i], a[k])) return false;
    return true;
  }
  var prim = true;
  for (i = 0; i < n; i++) { var x = a[i]; if (x !== null && typeof x === 'object') { prim = false; break; } }
  if (prim) {
    var s = new Set();
    for (i = 0; i < n; i++) { if (s.has(a[i])) return false; s.add(a[i]); }
    return true;
  }
  var m = new Map();
  for (i = 0; i < n; i++) {
    var hh = _uqh(a[i]), b = m.get(hh);
    if (b === undefined) m.set(hh, i);
    else if (typeof b === 'number') { if (_deq(a[b], a[i])) return false; m.set(hh, [b, i]); }
    else { for (k = 0; k < b.length; k++) if (_deq(a[b[k]], a[i])) return false; b.push(i); }
  }
  return true;
}

// The duplicate pair an error reports: the first item that has a later
// equal, and its first later equal. Returns that later index and leaves the
// first in _uqpI, or returns -1 when every item is distinct.
var _uqpI = 0;
function _uqp(a) {
  var n = a.length, i, k;
  if (n < 2) return -1;
  if (n <= 12) {
    for (i = 0; i < n - 1; i++) for (k = i + 1; k < n; k++) if (_deq(a[i], a[k])) { _uqpI = i; return k; }
    return -1;
  }
  var prim = true;
  for (i = 0; i < n; i++) { var x = a[i]; if (x !== null && typeof x === 'object') { prim = false; break; } }
  var bi = -1, bj = -1, m = new Map();
  if (prim) {
    for (i = 0; i < n; i++) {
      var p = m.get(a[i]);
      if (p === undefined) m.set(a[i], i);
      else if (p >= 0) { if (bi < 0 || p < bi) { bi = p; bj = i; } m.set(a[i], -1); }
    }
  } else {
    // Each bucket holds the first occurrence of every distinct value that
    // hashed there, in index order; a value is paired with its first later
    // equal only once.
    var paired = null;
    for (i = 0; i < n; i++) {
      var hh = _uqh(a[i]), b = m.get(hh), r = -1;
      if (b === undefined) { m.set(hh, i); continue; }
      if (typeof b === 'number') { if (_deq(a[b], a[i])) r = b; else m.set(hh, [b, i]); }
      else { for (k = 0; k < b.length; k++) if (_deq(a[b[k]], a[i])) { r = b[k]; break; } if (r < 0) b.push(i); }
      if (r >= 0) {
        if (paired === null) paired = new Set();
        if (!paired.has(r)) { paired.add(r); if (bi < 0 || r < bi) { bi = r; bj = i; } }
      }
    }
  }
  if (bi < 0) return -1;
  _uqpI = bi;
  return bj;
}

// For the interpreted engine.
function allDistinct(a) { return _uq(a); }
function duplicatePair(a) {
  var j = _uqp(a);
  return j < 0 ? null : [_uqpI, j];
}

module.exports = { allDistinct, duplicatePair, _deq, _uqh, _uq, _uqp };
