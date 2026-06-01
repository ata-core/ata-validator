'use strict';

// Custom error messages via the `errorMessage` keyword.
//
// A subschema may declare an `errorMessage` keyword to override the generated
// `message` on any error it owns:
//
//   errorMessage: "single message for any failure of this subschema"
//   errorMessage: {
//     <keyword>: "msg",                 // e.g. minimum, type, pattern, format
//     required: "msg" | { prop: "msg" },// keyed by missing property, or one string
//     additionalProperties: "msg",
//     _: "fallback msg",                // used when no keyword-specific entry matches
//   }
//
// Resolution: each error's owning subschema is located from its schemaPath (the
// keyword is the last pointer segment, the owner is everything before it). If the
// owner declares an errorMessage, the error's `message` is replaced. Errors are
// cloned, never mutated, so frozen/shared results stay intact. When no schema in
// the tree carries an errorMessage the decorator is never installed, so the
// validate hot path keeps its original cost.

// Locate the schema object that owns the failing keyword. Mirrors
// resolveSchemaByPath() in index.js: the last pointer segment is the keyword,
// so the owner is the node reached by walking every segment before it.
function resolveOwner (rootSchema, schemaPath) {
  if (!schemaPath || typeof schemaPath !== 'string' || schemaPath[0] !== '#') return undefined;
  const stripped = schemaPath.slice(1);
  if (!stripped || stripped === '/') return rootSchema;
  const parts = stripped.split('/').filter(Boolean).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let target = rootSchema;
  for (let i = 0; i < parts.length - 1; i++) {
    if (target == null || typeof target !== 'object') return undefined;
    target = target[parts[i]];
  }
  return target;
}

// Pick the override string for a single error from its owner's errorMessage.
// Returns undefined when nothing matches, leaving the default message in place.
function pickMessage (em, err) {
  if (em == null) return undefined;
  if (typeof em === 'string') return em;
  if (typeof em !== 'object') return undefined;

  const kw = err.keyword;

  if (kw === 'required') {
    const r = em.required;
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object') {
      const prop = err.params && err.params.missingProperty;
      if (prop != null && typeof r[prop] === 'string') return r[prop];
    }
  }

  if (kw != null && typeof em[kw] === 'string') return em[kw];
  if (typeof em._ === 'string') return em._;
  return undefined;
}

// Returns true when the schema string is worth scanning at validate time.
function schemaHasErrorMessages (schemaStr) {
  return typeof schemaStr === 'string' && schemaStr.indexOf('"errorMessage"') !== -1;
}

// Apply overrides across an error array. Returns the same array reference when
// nothing changed (so callers can cheaply detect a no-op), or a new array with
// cloned-and-overridden entries.
function applyErrorMessages (errors, rootSchema) {
  if (!errors || !errors.length) return errors;
  let changed = false;
  const out = new Array(errors.length);
  for (let i = 0; i < errors.length; i++) {
    const err = errors[i];
    out[i] = err;
    if (!err || typeof err.schemaPath !== 'string') continue;
    const owner = resolveOwner(rootSchema, err.schemaPath);
    if (!owner || typeof owner !== 'object') continue;
    const msg = pickMessage(owner.errorMessage, err);
    if (msg == null) continue;
    out[i] = Object.assign({}, err, { message: msg });
    changed = true;
  }
  return changed ? out : errors;
}

module.exports = { schemaHasErrorMessages, applyErrorMessages, resolveOwner, pickMessage };
