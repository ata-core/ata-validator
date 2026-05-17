'use strict';

// Bounded Levenshtein. Returns Infinity if distance > maxDistance.
// Single-row DP. O(n*m) worst case but typical strings are <30 chars.
function levenshtein (a, b, maxDistance) {
  const max = maxDistance == null ? Infinity : maxDistance;
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return Infinity;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return Infinity;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

module.exports = { levenshtein };
