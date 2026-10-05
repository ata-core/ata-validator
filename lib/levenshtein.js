'use strict';

// Bounded Levenshtein. Returns Infinity if distance > maxDistance (or, past
// the bound, possibly some number greater than it; callers compare).
//
// Only the cells within the bound of the diagonal are computed: a path
// through any other cell already costs more than the bound. A typo hint asks
// with a bound of one or two and compares the missing name with every key
// present, so a row is five cells instead of the whole key. Without a bound
// the band is the whole row.
//
// Two rows of scratch, reused across calls. The function is not recursive
// and the library is single-threaded, so nothing else is using them; growing
// them once beats allocating two arrays on every comparison, which the
// reject-path profile showed as most of this function's cost.
let scratchA = new Int32Array(64);
let scratchB = new Int32Array(64);

function levenshtein (a, b, maxDistance) {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  const max = maxDistance == null || maxDistance > n + m ? n + m : maxDistance;
  if (Math.abs(n - m) > max) return Infinity;
  if (n === 0) return m;
  if (m === 0) return n;
  const big = max + 1;
  if (scratchA.length < m + 2) {
    scratchA = new Int32Array(m + 2);
    scratchB = new Int32Array(m + 2);
  }
  let prev = scratchA;
  let curr = scratchB;
  for (let j = 0; j <= m; j++) prev[j] = j <= max ? j : big;
  for (let i = 1; i <= n; i++) {
    const lo = i - max > 1 ? i - max : 1;
    const hi = i + max < m ? i + max : m;
    curr[lo - 1] = lo === 1 ? i : big;
    let rowMin = curr[lo - 1];
    // charCodeAt rather than indexing: reading a character by index allocates
    // a one-character string, and this is the innermost loop.
    const ca = a.charCodeAt(i - 1);
    for (let j = lo; j <= hi; j++) {
      let v = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      const del = curr[j - 1] + 1;
      if (del < v) v = del;
      const ins = prev[j] + 1;
      if (ins < v) v = ins;
      if (v > big) v = big;
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < m) curr[hi + 1] = big;
    if (rowMin > max) return Infinity;
    // A destructured swap builds an array per row; a temporary does not.
    const t = prev;
    prev = curr;
    curr = t;
  }
  return prev[m] > max ? Infinity : prev[m];
}

module.exports = { levenshtein };
