'use strict';

// The closure passes that change a document before the verdict: coercion
// (coerceTypes) and removal of undeclared keys (removeAdditional, in
// lib/remove-additional.js). Used where
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

// The removeAdditional pass is lib/remove-additional.js. `patternOf` is the
// caller's engine's pattern compile, which keys are matched with.
function buildRemover(schema, patternOf) {
  return require('./remove-additional').buildRemover(schema, patternOf);
}

module.exports = { buildCoercer, buildRemover };
