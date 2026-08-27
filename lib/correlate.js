'use strict';

const { levenshtein } = require('./levenshtein');

const MAX_DISTANCE = 2;

/**
 * Pair a `required` error naming a missing property with an
 * `additionalProperties` error naming an extra property, when the two names
 * are close enough to be one typo and nothing else in the same container is
 * equally close.
 *
 * The tie checks are the point. `suggestRequiredTypo` in lib/suggestions.js
 * takes the first key within distance 2 and does not check for ties, which is
 * fine for a hint appended to an error that stands on its own. It is not fine
 * as a reason to present two errors as one problem: an ambiguous pairing would
 * tell the reader a confident story about the wrong key.
 *
 * Nothing is deleted. The result is a symmetric index map that callers may use
 * to group; every error stays in the array.
 *
 * @param {Array} errors enriched or raw validation errors
 * @returns {Map<number, number>} symmetric index pairs, empty when unresolved
 */
function correlateTypos (errors) {
  const out = new Map();
  if (!Array.isArray(errors) || errors.length < 2) return out;

  // Bucket by container pointer. A missing key in one object has nothing to do
  // with an extra key in another.
  const byContainer = new Map();
  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];
    if (!e || !e.params) continue;
    const missing = e.keyword === 'required' ? e.params.missingProperty : undefined;
    const additional = e.keyword === 'additionalProperties' ? e.params.additionalProperty : undefined;
    if (typeof missing !== 'string' && typeof additional !== 'string') continue;
    const key = e.instancePath != null ? e.instancePath : (e.path || '');
    let bucket = byContainer.get(key);
    if (!bucket) { bucket = { missing: [], extra: [] }; byContainer.set(key, bucket); }
    if (typeof missing === 'string') bucket.missing.push({ index: i, name: missing });
    else bucket.extra.push({ index: i, name: additional });
  }

  for (const bucket of byContainer.values()) {
    if (bucket.missing.length === 0 || bucket.extra.length === 0) continue;

    // Full distance table for this container. Sizes here are the number of
    // wrong keys in one object, so this stays small in practice.
    const dist = [];
    for (let m = 0; m < bucket.missing.length; m++) {
      dist.push([]);
      for (let x = 0; x < bucket.extra.length; x++) {
        const d = levenshtein(bucket.missing[m].name, bucket.extra[x].name, MAX_DISTANCE);
        dist[m].push(d);
      }
    }

    for (let m = 0; m < bucket.missing.length; m++) {
      // Best extra key for this missing key, and whether it is unique.
      let bestX = -1;
      let bestD = Infinity;
      let tied = false;
      for (let x = 0; x < bucket.extra.length; x++) {
        const d = dist[m][x];
        if (d < bestD) { bestD = d; bestX = x; tied = false; }
        else if (d === bestD && d !== Infinity) tied = true;
      }
      if (bestX === -1 || tied) continue;
      if (!(bestD > 0 && bestD <= MAX_DISTANCE)) continue;

      // And the same question from the other side: is this missing key the
      // unambiguous best match for that extra key?
      let backM = -1;
      let backD = Infinity;
      let backTied = false;
      for (let m2 = 0; m2 < bucket.missing.length; m2++) {
        const d = dist[m2][bestX];
        if (d < backD) { backD = d; backM = m2; backTied = false; }
        else if (d === backD && d !== Infinity) backTied = true;
      }
      if (backTied || backM !== m) continue;

      out.set(bucket.missing[m].index, bucket.extra[bestX].index);
      out.set(bucket.extra[bestX].index, bucket.missing[m].index);
    }
  }

  return out;
}

module.exports = { correlateTypos };
