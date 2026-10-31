'use strict';

// The closure pass that fills `default` values, shared by the validator core
// and by the wrapper around a compiled module, so both fill defaults the same
// way. The generated pass in lib/codegen-engine.js is held to this one by
// tests/test_nested_defaults_engines.js.
//
// A default is filled in every schema applied to the value at that place, as
// ajv's `useDefaults` fills one: the schemas under `properties`, through a
// `$ref` into the same document (recursive ones included), each `allOf`
// member, `items` for every element and `prefixItems` by position,
// `patternProperties` for the keys they match, `additionalProperties` for the
// rest, and `dependentSchemas` for the keys present. The pass stopped at
// `properties`, so a default behind a reference or in an array element was
// not filled, and a `required` property with one was rejected where ajv
// accepts it. `anyOf`, `oneOf` and `not` fill nothing, as with ajv;
// `if`/`then`/`else` fill nothing here, since which branch applies is only
// known once the value has been checked.

// Below a value nested this deep the pass stops: data that contains itself,
// under a recursive schema, would otherwise never end.
const MAX_DEPTH = 512;

// Build the pass for a schema: a function that fills defaults into a value in
// place (mutates), or null when no default is reachable from the schema.
// `keyMatcher` turns a patternProperties pattern into something with a
// `test` method; without one the platform RegExp is used. The runtime hands
// in the matcher validation uses (see safeKeyMatcher below), so a key that
// makes a backtracking pattern run for seconds costs no more here than it
// does to validate. A module written ahead of time embeds this function as
// text and calls it without one.
function buildDefaultsApplier(schema, keyMatcher) {
  if (typeof schema !== "object" || schema === null) return null;
  // `visits`: per call, the schemas already applied to each object through a
  // `$ref` or an `allOf` member. Applying one twice to the same object fills
  // nothing new, and following every edge of a chain such as
  // n_i = allOf [n_(i-1), n_(i-1)] cost 2^n applications of one schema.
  const ctx = { root: schema, memo: new Map(), reach: new Map(), path: [], res: resourceRoots(schema), match: keyMatcher || keyPattern, visits: null };
  const fn = compileNode(schema, ctx);
  return fn === null ? null : (data) => { ctx.path.length = 0; ctx.visits = null; fn(data, 0, null); };
}

// Write an own property. Plain assignment of a key named `__proto__` does
// not create a property at all: it hits the Object.prototype setter and
// rewrites the object's prototype, which is how a schema could reach
// Object.prototype itself. defineProperty has no such special case.
function setOwn(obj, key, val) {
  if (key === "__proto__") {
    Object.defineProperty(obj, key, {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    obj[key] = val;
  }
}

// The schema a `$ref` names in the same document: `#`, or a JSON pointer
// after it. Null for anything else (another document, an anchor), which the
// pass leaves alone. Normalization renames draft-07 `definitions` to `$defs`
// and leaves the pointers as written, so either name reads as the other.
function localRef(root, ref) {
  if (typeof ref !== "string" || ref.charCodeAt(0) !== 35) return null;
  if (ref === "#") return root;
  if (ref.charCodeAt(1) !== 47) return null;
  let t = root;
  for (let seg of ref.slice(2).split("/")) {
    if (seg.indexOf("%") >= 0) { try { seg = decodeURIComponent(seg); } catch { return null; } }
    if (seg.indexOf("~") >= 0) seg = seg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (t === null || typeof t !== "object") return null;
    if (!Object.hasOwn(t, seg)) {
      const alias = seg === "definitions" ? "$defs" : seg === "$defs" ? "definitions" : null;
      if (alias === null || !Object.hasOwn(t, alias)) return null;
      seg = alias;
    }
    t = t[seg];
  }
  return t !== null && typeof t === "object" ? t : null;
}

// For a schema that embeds other resources (a subschema with its own `$id`),
// the resource each schema object belongs to: a fragment `$ref` inside one
// is read against that resource, as validation reads it, not against the
// outer root. Null when nothing is embedded, which is nearly always. An `$id`
// that is only a fragment (`#foo`, a draft-07 anchor) starts no resource.
// Values under `default`, `const`, `enum` and `examples` are data, not
// schemas, and are not walked.
function resourceRoots(root) {
  if (root === null || typeof root !== "object") return null;
  const map = new Map();
  let embedded = false;
  const walk = (node, res) => {
    if (node === null || typeof node !== "object" || map.has(node)) return;
    if (Array.isArray(node)) { map.set(node, res); for (let i = 0; i < node.length; i++) walk(node[i], res); return; }
    if (node !== root && typeof node.$id === "string" && node.$id.charCodeAt(0) !== 35) { res = node; embedded = true; }
    map.set(node, res);
    for (const k of Object.keys(node)) {
      if (k === "default" || k === "const" || k === "enum" || k === "examples") continue;
      walk(node[k], res);
    }
  };
  walk(root, root);
  return embedded ? map : null;
}

// The schema a `$ref` on `node` names, read against the resource `node`
// belongs to.
function refTarget(root, res, node) {
  const base = res !== null ? res.get(node) : undefined;
  return localRef(base !== undefined ? base : root, node.$ref);
}

// Whether a default is reachable from a schema, through the same places the
// pass goes: 1 yes, 0 no, 2 not known yet because the walk came back to a
// schema it is still deciding (a recursive reference). Answers are kept per
// schema object in `memo`, except one that rests on an undecided schema,
// which is worked out again when asked; the walk used to start over for every
// schema object it compiled, quadratic in the depth of the schema.
function reachesDefault(node, root, memo, stack, res) {
  if (node === null || typeof node !== "object") return 0;
  const known = memo.get(node);
  if (known !== undefined) return known;
  if (stack.has(node)) return 2;
  stack.add(node);
  const props = valuesOf(node.properties);
  let yes = props.some((p) => p && typeof p === "object" && p.default !== undefined);
  let open = false;
  const below = props.concat(refTarget(root, res, node), listOf(node.allOf), listOf(node.prefixItems), node.items, node.additionalProperties, valuesOf(node.patternProperties), valuesOf(node.dependentSchemas));
  for (let i = 0; !yes && i < below.length; i++) {
    const r = reachesDefault(below[i], root, memo, stack, res);
    if (r === 1) yes = true;
    else if (r === 2) open = true;
  }
  stack.delete(node);
  if (yes || !open) memo.set(node, yes ? 1 : 0);
  return yes ? 1 : open ? 2 : 0;
}
function valuesOf(m) {
  return m && typeof m === "object" && !Array.isArray(m) ? Object.values(m) : [];
}
function listOf(a) {
  return Array.isArray(a) ? a : [];
}

// A pattern of `patternProperties` as the validator reads one.
function keyPattern(src) {
  try { return new RegExp(src, "u"); } catch { try { return new RegExp(src); } catch { return null; } }
}

// A fresh copy of a default for each value it fills. `[]`, the most common
// object default (2916 of the 4130 SARIF's schema fills into one log), skips
// the JSON round trip.
function copyOf(v) {
  return typeof v !== "object" || v === null ? v : Array.isArray(v) && v.length === 0 ? [] : JSON.parse(JSON.stringify(v));
}

// The pass for one schema object, built once: its own defaults, then the
// schemas below its properties, then its `$ref` and its `allOf` members, each
// applied to the same value. A schema reached again (a recursive reference)
// takes the function being built for it, so a cycle in the schema is a loop
// in the calls, bounded by the depth of the data.
function compileNode(node, ctx) {
  if (node === null || typeof node !== "object") return null;
  const memo = ctx.memo, path = ctx.path;
  if (memo.has(node)) return memo.get(node);
  if (reachesDefault(node, ctx.root, ctx.reach, new Set(), ctx.res) !== 1) { memo.set(node, null); return null; }
  let body = null;
  // `path`: the schemas applied to the enclosing values, outermost first.
  // `made`: inside a value the pass itself made from a default, the same as a
  // set, and null elsewhere. There a schema already applied to an enclosing
  // value is not applied again: one that refers back to an enclosing schema,
  // with an object default, would otherwise make a value, fill it, make the
  // next one inside it, and never stop. ajv throws a RangeError on such a
  // schema, and Renovate's took this pass to the heap limit.
  const fn = (data, depth, made) => {
    if (depth > MAX_DEPTH) return;
    // Only what is applied through a `$ref` or `allOf` is counted (fn.shared,
    // set below), and only outside a made value, where every application
    // does the same work.
    if (fn.shared === true && made === null && typeof data === "object" && data !== null) {
      const visits = ctx.visits || (ctx.visits = new Map());
      let done = visits.get(data);
      if (done === undefined) visits.set(data, (done = new Set()));
      if (done.has(node)) return;
      done.add(node);
    }
    if (made !== null) {
      if (made.has(node)) return;
      made.add(node);
      body(data, depth, made);
      made.delete(node);
      return;
    }
    path.push(node);
    body(data, depth, null);
    path.pop();
  };
  memo.set(node, fn);

  const own = [];
  const below = [];
  const props = node.properties;
  if (props && typeof props === "object") {
    for (const key of Object.keys(props)) {
      const p = props[key];
      if (!p || typeof p !== "object") continue;
      if (p.default !== undefined) own.push([key, p.default]);
      const child = compileNode(p, ctx);
      if (child !== null) below.push([key, child]);
    }
  }
  // Arrays: every element under `items`, the elements `prefixItems` names by
  // position (then `items` covers only the ones after them).
  const tuple = Array.isArray(node.prefixItems) ? node.prefixItems.map((s) => compileNode(s, ctx)) : [];
  const each = compileNode(node.items, ctx);
  // Objects: keys a pattern matches, and the keys neither `properties` nor a
  // pattern names; and a schema for each key present.
  const patterns = [];
  if (node.patternProperties && typeof node.patternProperties === "object") {
    for (const src of Object.keys(node.patternProperties)) {
      const re = ctx.match(src);
      const t = compileNode(node.patternProperties[src], ctx);
      if (re === null) continue;
      patterns.push([re, t]);
    }
  }
  const extra = compileNode(node.additionalProperties, ctx);
  const declared = props && typeof props === "object" ? props : null;
  const dependent = [];
  if (node.dependentSchemas && typeof node.dependentSchemas === "object") {
    for (const key of Object.keys(node.dependentSchemas)) {
      const t = compileNode(node.dependentSchemas[key], ctx);
      if (t !== null) dependent.push([key, t]);
    }
  }
  const keyed = extra !== null || patterns.some((p) => p[1] !== null);

  const also = [];
  if (typeof node.$ref === "string") {
    const t = compileNode(refTarget(ctx.root, ctx.res, node), ctx);
    if (t !== null) { t.shared = true; also.push(t); }
  }
  if (Array.isArray(node.allOf)) {
    for (const s of node.allOf) {
      const t = compileNode(s, ctx);
      if (t !== null) { t.shared = true; also.push(t); }
    }
  }

  body = (data, depth, made) => {
    // A value that is not an object has nothing to fill, here or in any
    // schema applied to it.
    if (typeof data !== "object" || data === null) return;
    let fresh = null;
    {
      for (let i = 0; i < own.length; i++) {
        const key = own[i][0];
        if (!Object.hasOwn(data, key)) {
          const v = copyOf(own[i][1]);
          setOwn(data, key, v);
          if (made === null && typeof v === "object" && v !== null) (fresh || (fresh = [])).push(key);
        }
      }
      for (let i = 0; i < below.length; i++) {
        // Own keys only. `data[key]` for an inherited name walks the
        // prototype chain: a property named `__proto__` that the value does
        // not carry resolved to Object.prototype, and the defaults below it
        // were written onto it, for every object in the realm.
        const key = below[i][0];
        if (Object.hasOwn(data, key)) below[i][1](data[key], depth + 1, fresh !== null && fresh.includes(key) ? new Set(path) : made);
      }
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          const t = i < tuple.length ? tuple[i] : each;
          if (t !== null && t !== undefined) t(data[i], depth + 1, made);
        }
      } else if (keyed) {
        for (const key of Object.keys(data)) {
          let matched = false;
          for (let i = 0; i < patterns.length; i++) {
            if (patterns[i][0].test(key)) { matched = true; if (patterns[i][1] !== null) patterns[i][1](data[key], depth + 1, made); }
          }
          if (extra !== null && !matched && !(declared !== null && Object.hasOwn(declared, key))) extra(data[key], depth + 1, made);
        }
      }
      if (!Array.isArray(data)) {
        for (let i = 0; i < dependent.length; i++) if (Object.hasOwn(data, dependent[i][0])) dependent[i][1](data, depth + 1, made);
      }
    }
    for (let i = 0; i < also.length; i++) also[i](data, depth + 1, made);
  };
  return fn;
}

// The functions a module written ahead of time embeds as its applyDefaults
// where the generated pass declines a schema (lib/aot-impl.js).
const EMBED = ['buildDefaultsApplier', 'setOwn', 'localRef', 'resourceRoots', 'refTarget', 'reachesDefault', 'valuesOf', 'listOf', 'keyPattern', 'copyOf', 'compileNode'];

// patternProperties keys tested in linear time: the linear-time engine
// (lib/safe-regex.js, which validation uses for these patterns too) for a
// pattern in its subset, the platform RegExp otherwise, as validation does.
// A key that makes a backtracking pattern run for seconds then costs no more
// here than it does to validate. lib/js-compiler.js also hands patterns the
// RegExp runs in linear time to the RegExp, for speed; that check is left
// out here so the closure pass, which lite carries, does not pull it in.
// Loaded on the first pattern; most schemas have none.
const PROP_ESCAPE = /\\[pP]\{/;
function safeKeyMatcher(src) {
  if (!PROP_ESCAPE.test(src)) {
    try {
      const safe = require("./safe-regex");
      if (safe.patternIsSafe(src)) return safe.compileSafe(src);
    } catch {}
  }
  return keyPattern(src);
}

module.exports = {
  buildDefaultsApplier: (schema) => buildDefaultsApplier(schema, safeKeyMatcher),
  setOwn, localRef, resourceRoots, refTarget, safeKeyMatcher, MAX_DEPTH, EMBED,
};
