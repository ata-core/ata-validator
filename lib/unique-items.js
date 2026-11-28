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
//
// Collisions. A bucket of equal hashes is compared item against item, which is
// quadratic when many items share one hash. A bucket compares each new item
// with its members only up to BUCKET_LIMIT of them (8); an item that arrives
// at a larger bucket is added without a comparison, and the buckets that grew
// that large are settled after the loop (_uqruns). Their indices are sorted by
// _uqcmp, a total preorder over any JS values that never says "different" for
// two values _deq calls equal, and each run of indices that _uqcmp ranks
// together is checked with _deq. _uqcmp only groups: _deq decides equality, as
// everywhere else. In a run of values JSON can carry, the first _deq succeeds,
// so a bucket of n such items costs O(n log n) comparisons. Values JSON cannot
// carry (NaN inside an object, functions, symbols, bigints, undefined) can be
// ranked together without being equal, and a run of them is still compared
// pairwise, as it was before.
//
// What a bucket past the limit costs that it did not before. A duplicate in it
// is found after the whole array has been read, not where it stands: the call
// takes as long as for an array with no duplicate, and an accessor that throws
// later in the array is reached where _uq used to return false first. And
// _uqcmp reads nested values in key order where _deq checks scalar values
// first, so records that share large equal arrays and differ in a later scalar
// sort slower than _deq compared them.

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
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  // Keys and scalar values first, nested values after, from the last key back:
  // two items of a list most often differ in a name, a path or an id, and
  // walking a nested list first made each comparison of rust-project's crates
  // three times what it needed (250 against 78 ns for the three; the default
  // validator's deep equal takes 115). Enumerable own keys on both sides: a
  // key at the same place in `b` is one, and any other is asked, own first,
  // which settles most unequal pairs without the slower enumerability test.
  for (i = ka.length; i-- !== 0;) {
    k = ka[i];
    if (kb[i] !== k && (!Object.prototype.hasOwnProperty.call(b, k) || !Object.prototype.propertyIsEnumerable.call(b, k))) return false;
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

// A rank for each kind of value, so that values of different kinds order
// apart. Everything JSON cannot carry (undefined, functions, symbols,
// bigints) has one rank and compares equal to each other.
function _uqrank(x) {
  if (x === null) return 0;
  var t = typeof x;
  if (t === 'boolean') return 1;
  if (t === 'number') return 2;
  if (t === 'string') return 3;
  if (t !== 'object') return 6;
  return Array.isArray(x) ? 4 : 5;
}

// The enumerable own keys of an object in order, cached for one sort.
function _uqkeys(x, kc) {
  var ks = kc.get(x);
  if (ks === undefined) { ks = Object.keys(x).sort(); kc.set(x, ks); }
  return ks;
}

// A total preorder over any JS values: -1, 0 or 1, antisymmetric and
// transitive, and 0 for every pair _deq calls equal. NaN is one value above
// every other number; 0 and -0 are one value; arrays order by length, then
// by position (a hole reads as undefined, as in _deq); objects by the number
// of keys, then their sorted names, then their values in that order.
function _uqcmp(a, b, kc) {
  if (a === b) return 0;
  var ra = _uqrank(a), rb = _uqrank(b), i, n, c;
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 1) return (a ? 1 : 0) - (b ? 1 : 0);
  if (ra === 2) {
    if (a !== a || b !== b) return a !== a ? (b !== b ? 0 : 1) : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (ra === 3) return a < b ? -1 : a > b ? 1 : 0;
  if (ra === 4) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    for (i = 0; i < a.length; i++) { c = _uqcmp(a[i], b[i], kc); if (c !== 0) return c; }
    return 0;
  }
  if (ra !== 5) return 0;
  var ka = _uqkeys(a, kc), kb = _uqkeys(b, kc);
  if (ka.length !== kb.length) return ka.length < kb.length ? -1 : 1;
  n = ka.length;
  for (i = 0; i < n; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  for (i = 0; i < n; i++) { c = _uqcmp(a[ka[i]], b[kb[i]], kc); if (c !== 0) return c; }
  return 0;
}

// Settles one bucket that grew past the comparison limit: the indices in `b`
// are sorted by _uqcmp (ties by index, so each run is in index order), and in
// each run of indices _uqcmp ranks together, _deq tests every item against the
// later ones. Returns the first equal pair [x, y] found, or null. With `all`
// false it stops at the first pair of any run; with `all` true it scans every
// run, stopping each at its first pair, and returns the pair with the smallest
// x, then the smallest y.
function _uqruns(a, b, all) {
  var kc = new Map(), best = null, s = 0, e, x, y, p;
  b.sort(function (i, j) { var c = _uqcmp(a[i], a[j], kc); return c !== 0 ? c : i - j; });
  while (s < b.length) {
    e = s + 1;
    while (e < b.length && _uqcmp(a[b[s]], a[b[e]], kc) === 0) e++;
    for (x = s; x < e - 1; x++) {
      for (y = x + 1; y < e; y++) {
        if (_deq(a[b[x]], a[b[y]])) {
          p = [b[x], b[y]];
          if (!all) return p;
          if (best === null || p[0] < best[0] || (p[0] === best[0] && p[1] < best[1])) best = p;
          x = e;
          break;
        }
      }
    }
    s = e;
  }
  return best;
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
  var m = new Map(), dq = null;
  for (i = 0; i < n; i++) {
    var hh = _uqh(a[i]), b = m.get(hh);
    if (b === undefined) m.set(hh, i);
    else if (typeof b === 'number') { if (_deq(a[b], a[i])) return false; m.set(hh, [b, i]); }
    else if (b.length > 8) b.push(i);
    else { for (k = 0; k < b.length; k++) if (_deq(a[b[k]], a[i])) return false; if (b.push(i) === 9) (dq || (dq = [])).push(b); }
  }
  if (dq !== null) for (i = 0; i < dq.length; i++) if (_uqruns(a, dq[i], false) !== null) return false;
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
  var bi = -1, bj = -1, m = new Map(), dq = null;
  if (prim) {
    for (i = 0; i < n; i++) {
      var p = m.get(a[i]);
      if (p === undefined) m.set(a[i], i);
      else if (p >= 0) { if (bi < 0 || p < bi) { bi = p; bj = i; } m.set(a[i], -1); }
    }
  } else {
    // Each bucket holds the first occurrence of every distinct value that
    // hashed there, in index order; a value is paired with its first later
    // equal only once. Once a bucket holds more than 8 indices, later items
    // are added without a comparison and the bucket is settled by _uqruns.
    var paired = null;
    for (i = 0; i < n; i++) {
      var hh = _uqh(a[i]), b = m.get(hh), r = -1;
      if (b === undefined) { m.set(hh, i); continue; }
      if (typeof b === 'number') { if (_deq(a[b], a[i])) r = b; else m.set(hh, [b, i]); }
      else if (b.length > 8) b.push(i);
      else { for (k = 0; k < b.length; k++) if (_deq(a[b[k]], a[i])) { r = b[k]; break; } if (r < 0 && b.push(i) === 9) (dq || (dq = [])).push(b); }
      if (r >= 0) {
        if (paired === null) paired = new Set();
        if (!paired.has(r)) { paired.add(r); if (bi < 0 || r < bi) { bi = r; bj = i; } }
      }
    }
    if (dq !== null) {
      for (i = 0; i < dq.length; i++) {
        var q = _uqruns(a, dq[i], true);
        if (q !== null && (bi < 0 || q[0] < bi || (q[0] === bi && q[1] < bj))) { bi = q[0]; bj = q[1]; }
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

module.exports = { allDistinct, duplicatePair, _deq, _uqh, _uqrank, _uqkeys, _uqcmp, _uqruns, _uq, _uqp };
