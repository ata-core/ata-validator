'use strict';

// The closure passes that change a document before the verdict: coercion
// (coerceTypes) and removal of undeclared keys (removeAdditional). Used where
// no generated pass is loaded: the full Validator in the browser and on the
// interpreted engine, and the 2.0 Validator (lib/validator-small.js).

// The preprocess passes act on own properties only; what the document
// inherits is not part of it, and a value found through the prototype belongs
// to some other object.
const _hasOwn = Object.prototype.hasOwnProperty;

// Build a function that coerces property values to match schema types in-place.
// Handles string→number, string→integer, string→boolean, number→string, boolean→string.
function buildCoercer(schema, arrayMode) {
  if (typeof schema !== "object" || schema === null) return null;
  const node = buildNodeCoercer(schema, new Set(), arrayMode === true);
  if (node === null) return null;
  return (data) => { if (typeof data === "object" && data !== null) node(data); };
}

// What to do with a value that sits at `schema`: coerce it (`scalar`) and then
// visit what is inside it (`inner`). Null when there is nothing.
function coercionFor(schema, seen) {
  if (!schema || typeof schema !== "object") return null;
  const scalar = schema.type && !Array.isArray(schema.type) ? buildSingleCoercion(schema.type) : null;
  const inner = buildNodeCoercer(schema, seen);
  return scalar || inner ? { scalar, inner } : null;
}

// The steps for the object or array at `schema`. `seen` stops a schema that
// contains itself through an inline cycle.
function buildNodeCoercer(schema, seen, arrayMode) {
  if (seen.has(schema)) return null;
  seen.add(schema);
  const steps = [];
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      // Assignment to `__proto__` would replace the prototype; the generated
      // pass skips it for the same reason.
      if (key === "__proto__") continue;
      // coerceTypes: 'array' wraps a lone value of a top-level property typed
      // array, as the generated pass does; this pass used to leave it.
      const wrap = arrayMode === true && prop && prop.type === "array";
      const c = coercionFor(prop, seen);
      if (!c && !wrap) continue;
      const { scalar, inner } = c || {};
      steps.push((o) => {
        // Own properties only: `key in o` found values the object inherits,
        // and the pass then rewrote the shared object behind them.
        if (!_hasOwn.call(o, key)) return;
        if (wrap && o[key] !== undefined && !Array.isArray(o[key])) o[key] = [o[key]];
        if (scalar) {
          const v = scalar(o[key]);
          if (v !== undefined) o[key] = v;
        }
        if (inner) {
          const x = o[key];
          if (typeof x === "object" && x !== null) inner(x);
        }
      });
    }
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    const c = coercionFor(schema.items, seen);
    if (c) {
      const { scalar, inner } = c;
      steps.push((o) => {
        if (!Array.isArray(o)) return;
        for (let i = 0; i < o.length; i++) {
          if (scalar) {
            const v = scalar(o[i]);
            if (v !== undefined) o[i] = v;
          }
          if (inner) {
            const x = o[i];
            if (typeof x === "object" && x !== null) inner(x);
          }
        }
      });
    }
  }
  seen.delete(schema);
  if (steps.length === 0) return null;
  if (steps.length === 1) return steps[0];
  return (o) => { for (let i = 0; i < steps.length; i++) steps[i](o); };
}

function buildSingleCoercion(targetType) {
  switch (targetType) {
    case "number":
      return (v) => {
        if (typeof v === "string") {
          const n = Number(v);
          if (v !== "" && !isNaN(n)) return n;
        }
        if (typeof v === "boolean") return v ? 1 : 0;
      };
    case "integer":
      return (v) => {
        if (typeof v === "string") {
          const n = Number(v);
          if (v !== "" && Number.isInteger(n)) return n;
        }
        if (typeof v === "boolean") return v ? 1 : 0;
      };
    case "string":
      return (v) => {
        if (typeof v === "number" || typeof v === "boolean") return String(v);
      };
    case "boolean":
      return (v) => {
        if (v === "true" || v === "1") return true;
        if (v === "false" || v === "0") return false;
      };
    default:
      return null;
  }
}

// Build a function that removes properties not defined in schema.properties.
// Walks nested objects recursively.
function buildRemover(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectRemovals(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

function collectRemovals(schema, actions, path) {
  if (typeof schema !== "object" || schema === null || !schema.properties)
    return;

  // If this level has additionalProperties: false, add a removal action
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties));
    if (!path) {
      actions.push((data) => {
        if (typeof data !== "object" || data === null || Array.isArray(data))
          return;
        const keys = Object.keys(data);
        for (let i = 0; i < keys.length; i++) {
          if (!allowed.has(keys[i])) delete data[keys[i]];
        }
      });
    } else {
      const parentPath = path;
      actions.push((data) => {
        let target = data;
        for (let j = 0; j < parentPath.length; j++) {
          // Own keys only: a nested object the document inherits is not part
          // of it, and deleting from it would strip a shared object.
          if (typeof target !== "object" || target === null || !_hasOwn.call(target, parentPath[j])) return;
          target = target[parentPath[j]];
        }
        if (
          typeof target !== "object" ||
          target === null ||
          Array.isArray(target)
        )
          return;
        const keys = Object.keys(target);
        for (let i = 0; i < keys.length; i++) {
          if (!allowed.has(keys[i])) delete target[keys[i]];
        }
      });
    }
  }

  // Always recurse into nested properties (they may have their own additionalProperties: false)
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop && typeof prop === "object" && prop.properties) {
      collectRemovals(prop, actions, (path || []).concat(key));
    }
  }
}

module.exports = { buildCoercer, buildRemover };
