'use strict';

// Declaration order of a schemaPath within its root schema.
//
// `rankFor` is the path of child indexes from the root to the node the
// schemaPath names (or to the deepest node it can reach), which sorts errors
// in the order their keywords appear in the schema. `ordinalFor` is the same
// order as one integer: the node's pre-order position in the schema tree.
// Comparing two ranks segment by segment gives exactly the pre-order
// relation, so the integer can stand in for the array, and the code
// generator can compute it once per error site instead of the reader
// deriving it from the path string on every rejection.
//
// Both are memoized per root schema; a validator's root never changes.

const _keyIndexCache = new WeakMap();
const _rankCache = new WeakMap();
const _ordinalCache = new WeakMap();

function keyIndex(node, seg) {
  let index = _keyIndexCache.get(node);
  if (index === undefined) {
    index = new Map();
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) index.set(keys[i], i);
    _keyIndexCache.set(node, index);
  }
  const at = index.get(seg);
  return at === undefined ? -1 : at;
}

// `~1` and `~0` are the only escapes a JSON pointer has, and almost no schema
// key contains a tilde. Looking for one is far cheaper than two regex passes
// over every segment of every path.
function unescapePointerSegment(seg) {
  return seg.indexOf('~') < 0 ? seg : seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

function escapePointerSegment(seg) {
  return seg.indexOf('~') < 0 && seg.indexOf('/') < 0 ? seg : seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

function rankFor(rootSchema, schemaPath) {
  if (!schemaPath || typeof schemaPath !== 'string' || !schemaPath.startsWith('#')) return null;
  if (rootSchema === null || typeof rootSchema !== 'object') return null;
  let byPath = _rankCache.get(rootSchema);
  if (byPath === undefined) { byPath = new Map(); _rankCache.set(rootSchema, byPath); }
  const hit = byPath.get(schemaPath);
  if (hit !== undefined) return hit;
  const rank = computeRank(rootSchema, schemaPath);
  byPath.set(schemaPath, rank);
  return rank;
}

function computeRank(rootSchema, schemaPath) {
  const rank = [];
  let node = rootSchema;
  let start = 1;
  while (start <= schemaPath.length) {
    let end = schemaPath.indexOf('/', start);
    if (end < 0) end = schemaPath.length;
    if (end === start) { start = end + 1; continue; }
    const seg = unescapePointerSegment(schemaPath.slice(start, end));
    start = end + 1;
    if (node == null || typeof node !== 'object') break;
    if (Array.isArray(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) break;
      rank.push(idx);
      node = node[idx];
    } else {
      const idx = keyIndex(node, seg);
      if (idx < 0) break;
      rank.push(idx);
      node = node[seg];
    }
  }
  return rank;
}

// Pre-order numbering of every node in the schema, keyed by its pointer as
// it appears in a schemaPath (segments escaped). Built once per root, on the
// first ask. Cyclic structures are guarded; a schema object can contain
// itself only through references, which are strings.
function ordinals(rootSchema) {
  let map = _ordinalCache.get(rootSchema);
  if (map !== undefined) return map;
  map = new Map();
  const seen = new Set();
  let next = 0;
  const walk = (node, pointer) => {
    map.set(pointer, next++);
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], pointer + '/' + i);
    } else {
      for (const key of Object.keys(node)) walk(node[key], pointer + '/' + escapePointerSegment(key));
    }
  };
  walk(rootSchema, '#');
  _ordinalCache.set(rootSchema, map);
  return map;
}

// The ordinal of the deepest node the schemaPath reaches; null when the path
// is not into this document.
function ordinalFor(rootSchema, schemaPath) {
  if (!schemaPath || typeof schemaPath !== 'string' || schemaPath.charCodeAt(0) !== 35) return null;
  if (rootSchema === null || typeof rootSchema !== 'object') return null;
  const map = ordinals(rootSchema);
  const hit = map.get(schemaPath);
  if (hit !== undefined) return hit;
  // Walk back to the longest prefix that exists. Paths through a keyword's
  // value that is a primitive, or through a key the schema does not have,
  // land on the nearest enclosing node.
  let p = schemaPath;
  while (true) {
    const cut = p.lastIndexOf('/');
    if (cut < 0) return 0;
    p = p.slice(0, cut);
    const o = map.get(p);
    if (o !== undefined) return o;
  }
}

module.exports = { rankFor, ordinalFor, unescapePointerSegment };
