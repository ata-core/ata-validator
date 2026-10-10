'use strict';

// A copy of a schema without the keywords that only describe it (title,
// description, examples and the like), for a compact module that embeds its
// schema so the shared error runtime can walk it. Validation never reads
// these, and in a typical published schema they are most of the bytes.
//
// Only schema positions are touched. An `enum`, a `const` or any keyword this
// file does not know is copied as it is, so a value that happens to hold a
// "description" key keeps it. If a local `$ref` points through a keyword that
// would be removed, nothing is removed: the reference has to land where it
// did.

const DROP = new Set([
  'title', 'description', '$comment', 'examples', 'default', 'deprecated',
  'readOnly', 'writeOnly', 'markdownDescription', 'deprecationMessage',
  'enumDescriptions', 'markdownEnumDescriptions', 'defaultSnippets',
]);

const SINGLE = new Set([
  'additionalProperties', 'contains', 'propertyNames', 'if', 'then', 'else', 'not',
  'items', 'unevaluatedItems', 'unevaluatedProperties', 'additionalItems', 'contentSchema',
]);
const MAPS = new Set(['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas']);
const LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

function dropped(key) {
  return DROP.has(key) || key.startsWith('x-');
}

function setOwn(o, k, v) {
  // A key named __proto__ has to stay an own property.
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
}

function unescape(seg) {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

// True when some local reference walks through a key that would be dropped.
function refsIntoDropped(node, seen) {
  if (node === null || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const x of node) if (refsIntoDropped(x, seen)) return true;
    return false;
  }
  for (const k of ['$ref', '$dynamicRef', '$recursiveRef']) {
    const r = node[k];
    if (typeof r !== 'string') continue;
    const hash = r.indexOf('#');
    if (hash < 0) continue;
    let frag;
    try { frag = decodeURIComponent(r.slice(hash + 1)); } catch { return true; }
    if (!frag.startsWith('/')) continue;
    for (const seg of frag.slice(1).split('/')) if (dropped(unescape(seg))) return true;
  }
  for (const k of Object.keys(node)) if (refsIntoDropped(node[k], seen)) return true;
  return false;
}

// keepTitle: the node is a branch of anyOf or oneOf, whose title names the
// branch in the collapsed error (params.closestName).
function stripSchema(node, keepTitle) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;
  const out = {};
  for (const k of Object.keys(node)) {
    if (dropped(k) && !(keepTitle === true && k === 'title')) continue;
    const v = node[k];
    if (SINGLE.has(k)) {
      setOwn(out, k, Array.isArray(v) ? v.map((x) => stripSchema(x, false)) : stripSchema(v, false));
    } else if (MAPS.has(k) && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const m = {};
      for (const name of Object.keys(v)) setOwn(m, name, stripSchema(v[name], false));
      setOwn(out, k, m);
    } else if (LISTS.has(k) && Array.isArray(v)) {
      const branches = k === 'anyOf' || k === 'oneOf';
      setOwn(out, k, v.map((x) => stripSchema(x, branches)));
    } else if (k === 'dependencies' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const m = {};
      for (const name of Object.keys(v)) setOwn(m, name, Array.isArray(v[name]) ? v[name] : stripSchema(v[name], false));
      setOwn(out, k, m);
    } else if (k === 'propertyDependencies' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const m = {};
      for (const name of Object.keys(v)) {
        const inner = v[name];
        if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) { setOwn(m, name, inner); continue; }
        const mi = {};
        for (const val of Object.keys(inner)) setOwn(mi, val, stripSchema(inner[val], false));
        setOwn(m, name, mi);
      }
      setOwn(out, k, m);
    } else {
      setOwn(out, k, v);
    }
  }
  return out;
}

function stripAnnotations(schema) {
  if (schema === null || typeof schema !== 'object') return schema;
  if (refsIntoDropped(schema, new Set())) return schema;
  return stripSchema(schema, false);
}

module.exports = { stripAnnotations };
