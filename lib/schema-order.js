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
// A path that runs on through a `$ref` names keys the referencing node does
// not have. Its ordinal is that of the `$ref` key, which several paths then
// share; its rank carries on inside the target, and the reader uses the rank
// to order the paths that share an ordinal.
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

// The documents a root's references reach beyond itself, id to schema, from
// the validators that own the root (the `schemas` option, addSchema) or a
// schema module's registry. Several validators of one root schema register
// their maps into one; an id that two of them give different schemas makes the
// root resolve nothing outside itself, as it did before any was registered.
const _documents = new WeakMap();
const CONFLICT = new Map();
function registerDocuments(rootSchema, map) {
  if (rootSchema === null || typeof rootSchema !== 'object' || !map || map.size === 0) return;
  const had = _documents.get(rootSchema);
  if (had === CONFLICT) return;
  if (had === undefined) { _documents.set(rootSchema, new Map(map)); _rankCache.delete(rootSchema); return; }
  let added = false;
  for (const [id, doc] of map) {
    const cur = had.get(id);
    if (cur === undefined) { had.set(id, doc); added = true; } else if (cur !== doc) { _documents.set(rootSchema, CONFLICT); _rankCache.delete(rootSchema); return; }
  }
  if (added) _rankCache.delete(rootSchema);
}

function withoutEmptyFragment(uri) {
  return uri.endsWith('#') ? uri.slice(0, -1) : uri;
}

function resolveUri(ref, base) {
  try { return base ? new URL(ref, base).href : new URL(ref).href; } catch { return null; }
}

function computeRank(rootSchema, schemaPath) {
  const rank = [];
  let node = rootSchema;
  let start = 1;
  let hops = 0;
  const docs = _documents.get(rootSchema);
  // The document the walk is in and the base URI references resolve against,
  // for following a reference into another document.
  let doc = rootSchema;
  let base = docs !== undefined && docs !== CONFLICT && typeof rootSchema.$id === 'string' ? resolveUri(rootSchema.$id, null) : null;
  while (start <= schemaPath.length) {
    let end = schemaPath.indexOf('/', start);
    if (end < 0) end = schemaPath.length;
    if (end === start) { start = end + 1; continue; }
    const seg = unescapePointerSegment(schemaPath.slice(start, end));
    if (node == null || typeof node !== 'object') break;
    if (base !== null && node !== doc && !Array.isArray(node) && typeof node.$id === 'string' && node.$id[0] !== '#') base = resolveUri(node.$id, base);
    if (Array.isArray(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) break;
      rank.push(idx);
      node = node[idx];
    } else {
      const idx = keyIndex(node, seg);
      if (idx < 0) {
        // An evaluation path runs on through a `$ref` into its target without
        // naming it. Ranking the rest inside the target, as if the target sat
        // under the `$ref` key, orders errors behind a reference by the
        // target's declaration order, as they are ordered inline.
        let target = hops < 64 ? localTarget(doc, node) : null;
        if (target === null && hops < 64 && base !== null) {
          const remote = remoteTarget(docs, base, node);
          if (remote !== null) { target = remote.node; doc = remote.doc; base = remote.base; }
        }
        if (target === null) break;
        hops++;
        rank.push(keyIndex(node, '$ref'));
        node = target;
        continue;
      }
      rank.push(idx);
      node = node[seg];
    }
    start = end + 1;
  }
  return rank;
}

// The schema a node's `$ref` names in a registered document: { node, doc,
// base }, or null when it names none (an anchor, an unknown document).
function remoteTarget(docs, base, node) {
  const ref = node.$ref;
  if (typeof ref !== 'string' || ref.charCodeAt(0) === 35) return null;
  const abs = resolveUri(ref, base);
  if (abs === null) return null;
  const hash = abs.indexOf('#');
  const uri = hash < 0 ? abs : abs.slice(0, hash);
  let target = docs.get(uri);
  if (target === undefined) target = docs.get(uri + '#');
  if (target === undefined) {
    for (const [id, s] of docs) if (withoutEmptyFragment(resolveUri(id, null) || '') === uri) { target = s; break; }
  }
  if (target === null || typeof target !== 'object') return null;
  const frag = hash < 0 ? '' : abs.slice(hash + 1);
  if (frag === '') return { node: target, doc: target, base: uri };
  if (frag.charCodeAt(0) !== 47) return null;
  const t = localTarget(target, { $ref: '#' + frag });
  return t === null ? null : { node: t, doc: target, base: uri };
}

// The schema a node's `$ref` names, when it is a pointer into this document.
function localTarget(rootSchema, node) {
  const ref = node.$ref;
  if (typeof ref !== 'string' || ref.charCodeAt(0) !== 35) return null;
  if (ref.length > 1 && ref.charCodeAt(1) !== 47) return null;
  let t = rootSchema;
  let start = 2;
  while (start <= ref.length && ref.length > 1) {
    let end = ref.indexOf('/', start);
    if (end < 0) end = ref.length;
    let seg = ref.slice(start, end);
    if (seg.indexOf('%') >= 0) { try { seg = decodeURIComponent(seg); } catch { return null; } }
    seg = unescapePointerSegment(seg);
    if (t === null || typeof t !== 'object') return null;
    // Normalization renames draft-07 `definitions` to `$defs` and leaves the
    // pointers as written; the resolvers read either name as the other.
    if (!Object.prototype.hasOwnProperty.call(t, seg)) {
      const alias = seg === 'definitions' ? '$defs' : seg === '$defs' ? 'definitions' : null;
      if (alias === null || !Object.prototype.hasOwnProperty.call(t, alias)) return null;
      seg = alias;
    }
    t = t[seg];
    start = end + 1;
  }
  return t !== null && typeof t === 'object' && t !== node ? t : null;
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
  // A path that is not a node is answered from the cache below, filled by the
  // walk after it: every error behind a `$ref`, which is every error of a
  // schema the interpreter answers through references, used to walk its path
  // back segment by segment on every read.
  let misses = _missCache.get(rootSchema);
  if (misses === undefined) { misses = new Map(); _missCache.set(rootSchema, misses); }
  const known = misses.get(schemaPath);
  if (known !== undefined) return known;
  // Walk back to the longest prefix that exists. Paths through a keyword's
  // value that is a primitive, or through a key the schema does not have,
  // land on the nearest enclosing node.
  // A path that runs on through a `$ref` lands on its `$ref` key, so errors
  // behind a reference sort where the `$ref` is declared among its siblings;
  // rankFor orders them among themselves.
  let p = schemaPath;
  let found = 0;
  while (true) {
    const cut = p.lastIndexOf('/');
    if (cut < 0) break;
    p = p.slice(0, cut);
    const o = map.get(p);
    if (o !== undefined) {
      const r = map.get(p + '/$ref');
      found = r !== undefined ? r : o;
      break;
    }
  }
  // Bounded: behind a recursive reference the paths grow with the document's
  // depth, and the cache must not grow with them.
  if (misses.size < MISS_CACHE_LIMIT) misses.set(schemaPath, found);
  return found;
}
const _missCache = new WeakMap();
const MISS_CACHE_LIMIT = 4096;

module.exports = { rankFor, ordinalFor, unescapePointerSegment, registerDocuments };
