'use strict';

// Declaration-order sorting for the shared error runtime
// (lib/error-runtime-entry.js), in its own file so the runtime Validator and
// ata-validator/lite, which sort by ordinals (lib/error-sort.js), do not carry
// it.
const { rankFor: schemaRank } = require('./schema-order');

// The same order from ranks alone: a rank is the path of child indexes from
// the root to the node an error names, built by walking that one path, while
// the ordinals above number every node of the schema on the first sort. The
// shared error runtime sorts this way, so a rejection costs a walk of the
// paths it reports, not of the schema. Comparing ranks segment by segment is
// the pre-order relation the ordinals encode (see lib/schema-order.js), and a
// path behind a local `$ref` ranks inside its target as the ordinal's tie
// does; the runtime only takes schemas whose references stay inside them. An
// error with no place in the document keeps the place of the one before it.
function compareRanks(a, b) {
  const m = Math.min(a.length, b.length);
  for (let k = 0; k < m; k++) if (a[k] !== b[k]) return a[k] - b[k];
  return a.length - b.length;
}

function sortErrorsByRank(rootSchema, errors) {
  let out = null;
  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];
    const b = e !== null && typeof e === 'object' ? e.branchErrors : undefined;
    if (!Array.isArray(b) || b.length === 0) continue;
    const sb = sortErrorsByRank(rootSchema, b);
    if (sb === b) continue;
    if (out === null) out = errors.slice();
    out[i] = Object.assign({}, e, { branchErrors: sb });
  }
  if (out !== null) errors = out;
  const n = errors.length;
  if (n < 2) return errors;
  const keys = new Array(n);
  let prev = [];
  let sorted = true;
  for (let i = 0; i < n; i++) {
    let r = schemaRank(rootSchema, errors[i].schemaPath);
    if (r === null) r = prev;
    keys[i] = r;
    if (i > 0 && compareRanks(prev, r) > 0) sorted = false;
    prev = r;
  }
  if (sorted) return errors;
  const res = errors.slice();
  for (let i = 1; i < n; i++) {
    const k = keys[i];
    const e = res[i];
    let j = i - 1;
    while (j >= 0 && compareRanks(keys[j], k) > 0) { keys[j + 1] = keys[j]; res[j + 1] = res[j]; j--; }
    keys[j + 1] = k;
    res[j + 1] = e;
  }
  return res;
}

module.exports = { sortErrorsByRank };
