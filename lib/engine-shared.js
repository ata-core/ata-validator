'use strict';

// What the interpreted engines share: the resource index and reference
// resolution, and how a pattern becomes a matcher. The interpreter
// (lib/interpreter-core.js) and the small engine that answers a page's first
// calls (lib/engine-small.js) both read these, so the two cannot resolve a
// reference or match a pattern differently.

// Read on the first pattern (see lib/js-compiler.js for why).
let _safeRe = null;
const compileSafe = (src) => (_safeRe || (_safeRe = require('./safe-regex'))).compileSafe(src);

// A pattern with no group or alternation, few bounded choices in all, and at
// most one unbounded repeat, on one character or class and only when the
// pattern starts with `^`, runs in linear time on a backtracking RegExp, so it
// takes the platform's: built in about a microsecond where the linear engine's
// automaton took 40 to 100, and faster to test. Every pattern accepted here
// also gets a RegExp from the code generator (lib/regex-linear.js), so both
// engines answer with the same matcher; tests/test_regex_plain_linear.js holds
// that and the answers.
const PLAIN_ATOM = /(?:\\[dDwWsS\\/.^$|?*+()[\]{}-]|\[\^?(?:[^\\\][^\ud800-\udfff]|\\[dws\\/.^$[\]-])(?:[^\\\][\ud800-\udfff]|\\[dws\\/.^$[\]-])*\]|[^\\[\](){}|*+?^$\ud800-\udfff])(\?|[*+]|\{(\d{1,3})(?:,(\d{1,3}))?\})?/y;
function plainLinear(src) {
  const n = src.length, anchored = src[0] === '^';
  if (n > 256) return false;
  let i = anchored ? 1 : 0, choices = 1, loops = 0;
  while (i < n) {
    if (src[i] === '$' && i === n - 1) return true;
    PLAIN_ATOM.lastIndex = i;
    const m = PLAIN_ATOM.exec(src);
    if (m === null) return false;
    i = PLAIN_ATOM.lastIndex;
    const q = m[1];
    if (q === '?') choices *= 2;
    else if (q === '*' || q === '+') { if (!anchored || ++loops > 1) return false; }
    else if (q !== undefined) { const lo = +m[2], hi = m[3] === undefined ? lo : +m[3]; if (hi < lo) return false; choices *= hi - lo + 1; }
    if (choices > 64) return false;
  }
  return true;
}

const SCHEMA_KEYWORDS = {
  single: ['additionalProperties', 'contains', 'propertyNames', 'if', 'then', 'else', 'not', 'items', 'unevaluatedItems', 'unevaluatedProperties'],
  maps: ['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'],
  lists: ['allOf', 'anyOf', 'oneOf', 'prefixItems'],
};

const FALLBACK_BASE = 'ata://root';

function resolveUri(base, ref) {
  try {
    return new URL(ref, base || FALLBACK_BASE).href;
  } catch {
    return ref;
  }
}

function splitFragment(uri) {
  const hash = uri.indexOf('#');
  if (hash < 0) return [uri, ''];
  return [uri.slice(0, hash), decodeURIComponent(uri.slice(hash + 1))];
}

// ---------- resource index ----------

// `flat`: the caller knows the schema holds no embedded resource and no
// anchor (the shared error runtime is told so by the build), so only the root
// is registered and the walk over every node is skipped. Every node then
// resolves against the root's base, which is what the walk would record.
function indexSchemas(rootSchema, schemaMap, flat) {
  const state = {
    resources: new Map(), // baseUri -> schema node of the resource root
    anchors: new Map(), // baseUri -> Map(anchorName -> node)
    dynamicAnchors: new Map(), // baseUri -> Map(anchorName -> node)
    nodeBase: new Map(), // schema node -> baseUri of its enclosing resource
    rootBase: FALLBACK_BASE,
  };

  const rootBase =
    typeof rootSchema === 'object' && rootSchema !== null && typeof rootSchema.$id === 'string'
      ? resolveUri(FALLBACK_BASE, splitFragment(rootSchema.$id)[0])
      : FALLBACK_BASE;
  state.rootBase = rootBase;
  if (flat === true && !schemaMap && typeof rootSchema === 'object' && rootSchema !== null) {
    state.resources.set(rootBase, rootSchema);
    state.nodeBase.set(rootSchema, rootBase);
    return state;
  }
  indexResource(rootSchema, rootBase, state);

  if (schemaMap) {
    for (const [id, schema] of schemaMap) {
      const base = resolveUri(FALLBACK_BASE, splitFragment(id)[0]);
      if (!state.resources.has(base)) indexResource(schema, base, state);
      // Also register under the raw key so non-URI ids stay addressable.
      if (!state.resources.has(id)) state.resources.set(id, schema);
    }
  }
  return state;
}

function anchorMap(maps, baseUri) {
  let m = maps.get(baseUri);
  if (m === undefined) maps.set(baseUri, (m = new Map()));
  return m;
}

function indexResource(node, baseUri, state) {
  if (typeof node !== 'object' || node === null) return;
  if (!state.resources.has(baseUri)) state.resources.set(baseUri, node);
  walkSchema(node, baseUri, state, true);
}

function walkSchema(node, baseUri, state, isResourceRoot) {
  if (typeof node !== 'object' || node === null) return;
  if (state.nodeBase.has(node)) return; // cycle guard
  state.nodeBase.set(node, baseUri);

  if (!isResourceRoot && typeof node.$id === 'string') {
    // Embedded resource: new base URI, indexed as its own resource.
    const newBase = splitFragment(resolveUri(baseUri, node.$id))[0];
    state.nodeBase.delete(node); // re-register under the new base
    indexResource(node, newBase, state);
    return;
  }

  // A resource's anchor maps are made at its first anchor: most schemas have
  // none, and two empty maps per resource were a sixth of a small schema's
  // interpreter. Every reader takes a missing map as no anchor.
  if (typeof node.$anchor === 'string') anchorMap(state.anchors, baseUri).set(node.$anchor, node);
  if (typeof node.$dynamicAnchor === 'string') {
    anchorMap(state.dynamicAnchors, baseUri).set(node.$dynamicAnchor, node);
    // A $dynamicAnchor is also addressable as a plain anchor.
    anchorMap(state.anchors, baseUri).set(node.$dynamicAnchor, node);
  }

  for (const kw of SCHEMA_KEYWORDS.single) {
    if (node[kw] !== undefined) walkSchema(node[kw], baseUri, state, false);
  }
  for (const kw of SCHEMA_KEYWORDS.maps) {
    const map = node[kw];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const key of Object.keys(map)) walkSchema(map[key], baseUri, state, false);
    }
  }
  for (const kw of SCHEMA_KEYWORDS.lists) {
    const list = node[kw];
    if (Array.isArray(list)) for (const sub of list) walkSchema(sub, baseUri, state, false);
  }
  // propertyDependencies nests one level deeper than the other maps:
  // property name -> property value -> schema.
  const propDeps = node.propertyDependencies;
  if (propDeps && typeof propDeps === 'object' && !Array.isArray(propDeps)) {
    for (const choices of Object.values(propDeps)) {
      if (choices && typeof choices === 'object' && !Array.isArray(choices)) {
        for (const sub of Object.values(choices)) walkSchema(sub, baseUri, state, false);
      }
    }
  }
}

// ---------- ref resolution ----------

function walkPointer(root, pointer) {
  if (pointer === '' || pointer === '/') return root;
  const parts = pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      node = node[Number(part)];
    } else if (part in node) {
      node = node[part];
    } else if (part === 'definitions' && node.$defs) {
      // draft-07 normalization renames definitions to $defs; keep old
      // pointers working (mirrors the 1.0.2 alias fix).
      node = node.$defs;
    } else if (part === '$defs' && node.definitions) {
      node = node.definitions;
    } else if (part === 'items' && Array.isArray(node.prefixItems)) {
      // draft-07 array-form items is normalized to prefixItems; pointers
      // written against the original document still land.
      node = node.prefixItems;
    } else {
      return undefined;
    }
  }
  return node;
}

function resolveRef(ref, fromBase, state) {
  const abs = resolveUri(fromBase, ref);
  const [uri, fragment] = splitFragment(abs);
  let resource = state.resources.get(uri);
  let resourceBase = uri;
  if (resource === undefined && (uri === FALLBACK_BASE || uri === '')) {
    resource = state.resources.get(state.rootBase);
    resourceBase = state.rootBase;
  }
  if (resource === undefined) {
    // Raw-id registration (schemaMap keys that are not URIs).
    const [rawUri, rawFragment] = splitFragment(ref);
    if (state.resources.has(rawUri)) {
      resource = state.resources.get(rawUri);
      resourceBase = rawUri;
      if (rawFragment === '') return { node: resource, base: resourceBase };
      if (rawFragment.startsWith('/')) return { node: walkPointer(resource, rawFragment), base: resourceBase };
      const anchored = state.anchors.get(resourceBase);
      return { node: anchored ? anchored.get(rawFragment) : undefined, base: resourceBase };
    }
    return { node: undefined, base: resourceBase };
  }
  if (fragment === '') return { node: resource, base: resourceBase };
  if (fragment.startsWith('/')) {
    const node = walkPointer(resource, fragment);
    // A pointer can land inside an embedded resource; its recorded base wins.
    const base = node !== null && typeof node === 'object' && state.nodeBase.has(node) ? state.nodeBase.get(node) : resourceBase;
    return { node, base };
  }
  const anchored = state.anchors.get(resourceBase);
  return { node: anchored ? anchored.get(fragment) : undefined, base: resourceBase };
}

// ---------- patterns ----------

// Unicode mode where the pattern is valid in it (reFlags in lib/js-compiler.js).
function uRe(src) {
  try { return new RegExp(src, 'u'); } catch { return new RegExp(src); }
}

// The matcher for a `pattern` or a patternProperties name.
function compilePattern(src) {
  let re;
  if (/\\[pP]\{/.test(src)) {
    // Unicode property escapes need a real RegExp in unicode mode; the
    // linear engine does not understand them (compileSafe refuses them),
    // so the RegExp answers whether or not it runs this pattern in linear
    // time. Asking lib/regex-linear.js would change no answer and would
    // add it to lite. A nested loop around a property escape can
    // backtrack here; SECURITY.md says so.
    re = uRe(src);
  } else if (plainLinear(src)) {
    // Unicode mode where the pattern is valid in it, as the generators write
    // it (reFlags in lib/js-compiler.js), so a character above U+FFFF is one
    // character (issue #94).
    re = uRe(src);
  } else {
    try {
      re = compileSafe(src);
    } catch (e) {
      // A parse failure means the engine cannot represent the pattern
      // (a backreference, a lookaround, an escape it does not implement,
      // a repeat past its instruction budget) and the platform RegExp
      // takes it.
      // The stub of a shared error runtime built without the engine
      // (lib/error-runtime.js) throws too, and that one is rethrown: a
      // module whose runtime lacks the engine must fail, not quietly
      // match on a RegExp that can backtrack.
      if (e && typeof e.message === 'string' && e.message.includes('built without the pattern engine')) throw e;
      re = uRe(src);
    }
  }
  return re;
}

module.exports = { indexSchemas, resolveRef, splitFragment, resolveUri, FALLBACK_BASE, plainLinear, compilePattern };
