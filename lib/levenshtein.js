'use strict';

// Bounded Levenshtein. Returns Infinity if distance > maxDistance.
// Single-row DP. O(n*m) worst case but typical strings are <30 chars.
// Two rows of scratch, reused across calls. The function is not recursive
// and the library is single-threaded, so nothing else is using them; growing
// them once beats allocating two arrays on every comparison, which the
// reject-path profile showed as most of this function's cost.
let scratchA = new Int32Array(64);
let scratchB = new Int32Array(64);

function levenshtein (a, b, maxDistance) {
  const max = maxDistance == null ? Infinity : maxDistance;
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return Infinity;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (scratchA.length < b.length + 1) {
    scratchA = new Int32Array(b.length + 1);
    scratchB = new Int32Array(b.length + 1);
  }
  let prev = scratchA;
  let curr = scratchB;
  const bn = b.length;
  for (let j = 0; j <= bn; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    // charCodeAt rather than indexing: reading a character by index allocates
    // a one-character string, and this is the innermost loop.
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bn; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let m = prev[j - 1] + cost;
      const del = curr[j - 1] + 1;
      if (del < m) m = del;
      const ins = prev[j] + 1;
      if (ins < m) m = ins;
      curr[j] = m;
      if (m < rowMin) rowMin = m;
    }
    if (rowMin > max) return Infinity;
    // A destructured swap builds an array per row; a temporary does not.
    const t = prev;
    prev = curr;
    curr = t;
  }
  return prev[bn];
}

module.exports = { levenshtein };
