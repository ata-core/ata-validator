'use strict';

// Whether a schema holds a reference that resolves to nothing where failing it
// in place could accept: under not, an if condition, a oneOf branch, a
// contains with maxContains or a node with unevaluated*, or beneath one. The
// interpreted engine and the closure compiler count those keywords as they
// go (Interpreter._inv); this reads the same rule from the schema, for the
// native walker (lib/buffer-gate.js) and ata-validator/ir, which cannot end a
// validation there. It follows every reference and every anchor a
// $dynamicRef could land on, so it errs towards yes.

const { indexSchemas, resolveRef } = require('./interpreter-core')._refInternals;

const SUBSCHEMAS = ['additionalProperties', 'contains', 'propertyNames', 'if', 'then', 'else', 'not', 'items', 'unevaluatedItems', 'unevaluatedProperties', 'allOf', 'anyOf', 'oneOf', 'prefixItems'];
const MAPS = ['properties', 'patternProperties', 'dependentSchemas', 'propertyDependencies'];

function hasNegativeRef(schema, schemaMap) {
  if (schema === null || typeof schema !== 'object') return false;
  const state = indexSchemas(schema, schemaMap && schemaMap.size > 0 ? schemaMap : null, false);
  const seen = [new Set(), new Set()];
  let found = false;
  const visit = (n, base, neg) => {
    if (found || n === null || typeof n !== 'object' || seen[neg].has(n)) return;
    seen[neg].add(n);
    base = state.nodeBase.get(n) || base;
    // A node with unevaluated* counts for all it applies, as in the walk.
    const u = neg | (n.unevaluatedProperties !== undefined || n.unevaluatedItems !== undefined);
    for (const ref of [n.$ref, n.$dynamicRef]) {
      if (typeof ref !== 'string') continue;
      const t = resolveRef(ref, base, state);
      if (t.node !== undefined) visit(t.node, t.base, u);
      else if (u) found = true;
    }
    if (n.$dynamicRef !== undefined) for (const m of state.dynamicAnchors.values()) for (const x of m.values()) visit(x, base, u);
    for (const k of Object.keys(n)) {
      const v = n[k];
      const f = u | (k === 'not' || k === 'if' || k === 'oneOf' || (k === 'contains' && n.maxContains !== undefined));
      if (MAPS.includes(k)) {
        if (v !== null && typeof v === 'object') for (const x of Object.keys(v)) for (const y of k === 'propertyDependencies' ? Object.values(v[x] || {}) : [v[x]]) visit(y, base, f);
      } else if (SUBSCHEMAS.includes(k)) for (const x of [].concat(v)) visit(x, base, f);
    }
  };
  visit(schema, state.rootBase, 0);
  return found;
}

module.exports = { hasNegativeRef };
