'use strict';
// The removeAdditional pass: in every object a schema with
// `additionalProperties: false` applies to, delete the keys that schema does
// not declare (`properties`, or a `patternProperties` pattern). It reaches the
// schemas validation applies to a value without choosing between them, as
// lib/defaults.js does for defaults: `properties`, `items` for every element
// and `prefixItems` by position, `patternProperties` for the keys they match,
// `additionalProperties` for the rest, `dependentSchemas` for the keys
// present, a `$ref` into the same document (recursive ones included) and each
// `allOf` member. The pass used to stop at `properties`, so a closed object
// in an array, behind a reference or in an `allOf` kept its extra keys and
// was rejected (issue #116).
//
// `anyOf`, `oneOf`, `not` and `if`/`then`/`else` are not followed: which of
// them applies is known only once the value has been checked, and removing
// keys for a branch that does not apply deletes data the one that does
// accepts. A member of `allOf` is closed against its own `properties` only,
// as validation reads it, so a key another member declares is removed by the
// closed one.
const { localRef, resourceRoots, refTarget, MAX_DEPTH } = require('./defaults');

// `patternOf` compiles a `patternProperties` pattern as the caller's engine
// matches keys (the interpreted engine's compile, or the IR's RegExp).
function buildRemover(schema, patternOf) {
  if (typeof schema !== 'object' || schema === null) return null;
  const ctx = { root: schema, memo: new Map(), reach: new Map(), res: resourceRoots(schema), patternOf, visits: null };
  const fn = compileNode(schema, ctx);
  // The visits map holds the values of one call only: cleared after it, so an
  // idle validator does not keep the last document alive.
  return fn === null ? null : (data) => { try { fn(data, 0); } finally { ctx.visits = null; } };
}

function valuesOf(m) {
  return m && typeof m === 'object' && !Array.isArray(m) ? Object.values(m) : [];
}
function listOf(a) {
  return Array.isArray(a) ? a : [];
}
function closed(node) {
  return node.additionalProperties === false;
}

// Whether a closed object is reachable from a schema through the places the
// pass goes: 1 yes, 0 no, 2 not known yet (a recursive reference still being
// decided), as reachesDefault in lib/defaults.js.
function reachesClosed(node, root, memo, stack, res) {
  if (node === null || typeof node !== 'object') return 0;
  const known = memo.get(node);
  if (known !== undefined) return known;
  if (stack.has(node)) return 2;
  stack.add(node);
  let yes = closed(node);
  let open = false;
  const below = yes ? [] : valuesOf(node.properties).concat(refTarget(root, res, node), listOf(node.allOf), listOf(node.prefixItems), node.items, node.additionalProperties, valuesOf(node.patternProperties), valuesOf(node.dependentSchemas));
  for (let i = 0; !yes && i < below.length; i++) {
    const r = reachesClosed(below[i], root, memo, stack, res);
    if (r === 1) yes = true;
    else if (r === 2) open = true;
  }
  stack.delete(node);
  if (yes || !open) memo.set(node, yes ? 1 : 0);
  return yes ? 1 : open ? 2 : 0;
}

function matchesAny(patterns, key) {
  for (let i = 0; i < patterns.length; i++) if (patterns[i][0].test(key)) return true;
  return false;
}

// The pass for one schema object, built once. A schema reached again (a
// recursive reference) takes the function being built for it, so a cycle in
// the schema is a loop in the calls, bounded by the depth of the data.
function compileNode(node, ctx) {
  if (node === null || typeof node !== 'object') return null;
  const memo = ctx.memo;
  if (memo.has(node)) return memo.get(node);
  if (reachesClosed(node, ctx.root, ctx.reach, new Set(), ctx.res) !== 1) { memo.set(node, null); return null; }
  let body = null, shared = false;
  const fn = (data, depth) => {
    if (depth > MAX_DEPTH || typeof data !== 'object' || data === null) return;
    // A schema applied to the same value twice, through a `$ref` or an
    // `allOf`, removes nothing new; a chain of them doubling at each level
    // would otherwise cost 2^n applications.
    // Skipped only when an earlier application reached the value at this
    // depth or above: one that came deeper may have stopped at the depth
    // bound before a closed object below that this one reaches.
    if (shared) {
      const visits = ctx.visits || (ctx.visits = new Map());
      let done = visits.get(data);
      if (done === undefined) visits.set(data, (done = new Map()));
      const at = done.get(node);
      if (at !== undefined && at <= depth) return;
      done.set(node, depth);
    }
    body(data, depth);
  };
  fn.share = () => { shared = true; };
  memo.set(node, fn);

  const props = node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties) ? node.properties : null;
  const below = [];
  if (props !== null) {
    for (const key of Object.keys(props)) {
      const child = compileNode(props[key], ctx);
      if (child !== null) below.push([key, child]);
    }
  }
  const patterns = [];
  if (node.patternProperties && typeof node.patternProperties === 'object' && !Array.isArray(node.patternProperties)) {
    for (const src of Object.keys(node.patternProperties)) patterns.push([ctx.patternOf(src), compileNode(node.patternProperties[src], ctx)]);
  }
  const shut = closed(node);
  const allowed = shut && props !== null ? new Set(Object.keys(props)) : null;
  const extra = shut ? null : compileNode(node.additionalProperties, ctx);
  const keyed = extra !== null || patterns.some((p) => p[1] !== null);
  const dependent = [];
  if (node.dependentSchemas && typeof node.dependentSchemas === 'object') {
    for (const key of Object.keys(node.dependentSchemas)) {
      const t = compileNode(node.dependentSchemas[key], ctx);
      if (t !== null) dependent.push([key, t]);
    }
  }
  const tuple = Array.isArray(node.prefixItems) ? node.prefixItems.map((s) => compileNode(s, ctx)) : [];
  const each = compileNode(node.items, ctx);
  const also = [];
  if (typeof node.$ref === 'string') {
    const t = compileNode(refTarget(ctx.root, ctx.res, node), ctx);
    if (t !== null) { t.share(); also.push(t); }
  }
  for (const s of listOf(node.allOf)) {
    const t = compileNode(s, ctx);
    if (t !== null) { t.share(); also.push(t); }
  }

  // The common node, a closed object and its properties, without the steps
  // it has nothing for.
  if (patterns.length === 0 && !keyed && dependent.length === 0 && tuple.length === 0 && each === null && also.length === 0) {
    body = (data, depth) => {
      if (Array.isArray(data)) return;
      if (allowed !== null) {
        const keys = Object.keys(data);
        for (let i = 0; i < keys.length; i++) if (!allowed.has(keys[i])) delete data[keys[i]];
      } else if (shut) {
        for (const k of Object.keys(data)) delete data[k];
      }
      for (let i = 0; i < below.length; i++) {
        const key = below[i][0];
        if (Object.hasOwn(data, key)) below[i][1](data[key], depth + 1);
      }
    };
    return fn;
  }
  body = (data, depth) => {
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const t = i < tuple.length ? tuple[i] : each;
        if (t !== null && t !== undefined) t(data[i], depth + 1);
      }
    } else {
      if (shut) {
        // Own keys only, as Object.keys gives them; an inherited object is
        // not part of the document.
        const keys = Object.keys(data);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (!(allowed !== null && allowed.has(k)) && (patterns.length === 0 || !matchesAny(patterns, k))) delete data[k];
        }
      }
      for (let i = 0; i < below.length; i++) {
        const key = below[i][0];
        if (Object.hasOwn(data, key)) below[i][1](data[key], depth + 1);
      }
      if (keyed) {
        for (const key of Object.keys(data)) {
          let matched = false;
          for (let i = 0; i < patterns.length; i++) {
            if (patterns[i][0].test(key)) { matched = true; if (patterns[i][1] !== null) patterns[i][1](data[key], depth + 1); }
          }
          if (extra !== null && !matched && !(props !== null && Object.hasOwn(props, key))) extra(data[key], depth + 1);
        }
      }
      for (let i = 0; i < dependent.length; i++) if (Object.hasOwn(data, dependent[i][0])) dependent[i][1](data, depth + 1);
    }
    for (let i = 0; i < also.length; i++) also[i](data, depth + 1);
  };
  return fn;
}

module.exports = { buildRemover, reachesClosed };
