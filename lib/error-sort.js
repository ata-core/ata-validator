'use strict';

// Declaration-order sorting of an error list. Its own file so the error
// runtime that compiled modules share (lib/error-runtime-entry.js) carries
// this and schema-order.js and nothing else from the rejection layer.
const { ordinalFor: schemaOrdinal, rankFor: schemaRank } = require('./schema-order');

// A collapsed oneOf/anyOf error carries the closest branch's errors, which
// each engine produces in its own walk order. They go in schema order like the
// list they sit in, so which engine answered cannot be read off them.
function sortBranchErrors(rootSchema, errors) {
  let out = null;
  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];
    const b = e !== null && typeof e === 'object' ? e.branchErrors : undefined;
    if (!Array.isArray(b) || b.length === 0) continue;
    const sb = sortErrorsBySchemaOrder(rootSchema, b);
    if (sb === b) continue;
    if (out === null) out = errors.slice();
    out[i] = Object.assign({}, e, { branchErrors: sb });
  }
  return out === null ? errors : out;
}

function sortErrorsBySchemaOrder(rootSchema, errors) {
  errors = sortBranchErrors(rootSchema, errors);
  const n = errors.length;
  const keys = new Array(n);
  let sorted = true;
  let prev = -1;
  let prevPath = null;
  for (let i = 0; i < n; i++) {
    const e = errors[i];
    let o = typeof e._o === 'number' ? e._o : schemaOrdinal(rootSchema, e.schemaPath);
    // An error with no place in this document (an appended custom-keyword
    // error, a path into another schema) stays next to the error before it,
    // which is where the rank comparison left it too.
    if (o === null) o = prev < 0 ? 0 : prev;
    keys[i] = o;
    if (o < prev || (o === prev && sorted && e.schemaPath !== prevPath && tieOrder(rootSchema, prevPath, e.schemaPath) > 0)) sorted = false;
    prev = o;
    prevPath = e.schemaPath;
  }
  if (sorted) return errors;
  // Error lists are short. A stable insertion sort over the integer keys
  // moves the errors in tandem with no index array; equal keys fall back to
  // the rank only when the paths differ.
  const out = errors.slice();
  for (let i = 1; i < n; i++) {
    const k = keys[i];
    const e = out[i];
    let j = i - 1;
    while (j >= 0 && (keys[j] > k || (keys[j] === k && tieOrder(rootSchema, out[j].schemaPath, e.schemaPath) > 0))) {
      keys[j + 1] = keys[j]; out[j + 1] = out[j]; j--;
    }
    keys[j + 1] = k;
    out[j + 1] = e;
  }
  return out;
}

// Order of two paths with the same ordinal: positive when `a` belongs after
// `b`. Zero keeps them as they are, for identical paths and for paths
// outside this document.
function tieOrder(rootSchema, a, b) {
  if (a === b) return 0;
  const ra = schemaRank(rootSchema, a), rb = schemaRank(rootSchema, b);
  if (ra === null || rb === null) return 0;
  const m = Math.min(ra.length, rb.length);
  for (let k = 0; k < m; k++) if (ra[k] !== rb[k]) return ra[k] - rb[k];
  return ra.length - rb.length;
}

module.exports = { sortErrorsBySchemaOrder };
