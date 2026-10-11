'use strict';

// Bounded edit distance. Returns Infinity if distance > maxDistance (or, past
// the bound, possibly some number greater than it; callers compare).
//
// Two adjacent characters swapped count as one edit, not two (the optimal
// string alignment distance): `nmae` for `name` is the commonest typo there
// is, and at two edits a four-letter name's budget of one turned it away.
//
// Only the cells within the bound of the diagonal are computed: a path
// through any other cell already costs more than the bound. A typo hint asks
// with a bound of one or two and compares the missing name with every key
// present, so a row is five cells instead of the whole key. Without a bound
// the band is the whole row.
//
// Three rows of scratch, reused across calls. The function is not recursive
// and the library is single-threaded, so nothing else is using them; growing
// them once beats allocating two arrays on every comparison, which the
// reject-path profile showed as most of this function's cost.
let scratchA = new Int32Array(64);
let scratchB = new Int32Array(64);
let scratchC = new Int32Array(64);

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
    scratchC = new Int32Array(m + 2);
  }
  // The row before the previous one, read for a swap: within the band of
  // row i the cell two back on the diagonal is inside the band of row i - 2.
  let prev2 = scratchC;
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
    const pa = i > 1 ? a.charCodeAt(i - 2) : -1;
    for (let j = lo; j <= hi; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ca === cb ? 0 : 1);
      const del = curr[j - 1] + 1;
      if (del < v) v = del;
      const ins = prev[j] + 1;
      if (ins < v) v = ins;
      if (j > 1 && ca !== cb && ca === b.charCodeAt(j - 2) && pa === cb) {
        const swap = prev2[j - 2] + 1;
        if (swap < v) v = swap;
      }
      if (v > big) v = big;
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < m) curr[hi + 1] = big;
    if (rowMin > max) return Infinity;
    // A destructured swap builds an array per row; temporaries do not.
    const t = prev2;
    prev2 = prev;
    prev = curr;
    curr = t;
  }
  return prev[m] > max ? Infinity : prev[m];
}

module.exports = { levenshtein };
