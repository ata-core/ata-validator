'use strict';

// What the two compiled wrappers share: which Validator options they accept,
// the defaults pass, and JSON parsing. lib/compiled.js answers all four entry
// points; lib/compiled-verdict.js answers only the two that return a boolean,
// so a bundle that never reads errors does not carry the error pipeline.

const { buildDefaultsApplier } = require('./defaults');

// The Validator options the wrapper answers the same way as the runtime.
// Anything else changes what the runtime does in a way the wrapper does not
// reproduce, so it is refused rather than ignored.
const COMPILED_OPTIONS = Object.freeze(['useDefaults']);

// With defaults, the document is filled in before it is checked, on every
// entry point, as the runtime does.
function prepare(mod, schema, options, name) {
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new TypeError(`${name} options must be an object`);
  }
  for (const key of Object.keys(options || {})) {
    if (!COMPILED_OPTIONS.includes(key)) {
      throw new TypeError(`${name} does not support the ${key} option; a Validator with it has to stay on the runtime`);
    }
  }
  const fill = options && options.useDefaults === false ? null : buildDefaultsApplier(schema);
  const isValid = fill ? (d) => { fill(d); return mod.isValid(d); } : mod.isValid;
  return { fill, isValid };
}

function parse(text) {
  try { return { value: JSON.parse(text) }; } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return { error: e };
  }
}

// A frozen stand-in, as the runtime reports, when a document fails and neither
// the schema nor the extension says why (the data changed in between).
const EXT_FALLBACK = Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: {}, message: 'schema validation failed' });

// A check the schema does not carry, registered the way @ata-project/keywords
// registers `instanceof` and `typeof` on a Validator: `_extendChecks(resolve)`
// before the first call, where resolve() returns { check, errors } or null.
// The wrapper answers as the runtime does under such a check
// (validator-core.js, _extendValidate and _jsonEntryWrappers): the verdict is
// the schema's and the check's; validate() lists the schema's errors, then
// the check's; the JSON entry points run the check only on text the schema
// accepts. `extend(ext)` returns the wrapper's methods under the check, and is
// called once, on the first call after registering, with the resolved check.
function installExtension(api, schema, extend) {
  let resolvers = null;
  const define = (name, value) => Object.defineProperty(api, name, { value, configurable: true, writable: true, enumerable: false });
  define('_schemaObj', schema);
  define('_initialized', false);
  define('_extendChecks', function (resolve) {
    if (typeof resolve !== 'function') throw new TypeError('_extendChecks expects a function');
    if (resolvers === null) {
      resolvers = [];
      const base = {};
      for (const name of Object.keys(api)) base[name] = api[name];
      // Resolved on the first call to any method, as the runtime resolves at
      // its first compile, and the methods are bound once from then on.
      let bound = null;
      const bind = () => {
        if (bound === null) {
          let ext = null;
          for (const r of resolvers) {
            const x = r();
            if (!x) continue;
            ext = ext === null ? x : combine(ext, x);
          }
          bound = ext === null ? base : extend(base, ext);
          for (const name of Object.keys(base)) api[name] = bound[name];
        }
        return bound;
      };
      for (const name of Object.keys(base)) api[name] = function (arg) { return bind()[name](arg); };
    }
    resolvers.push(resolve);
    return api;
  });
}

function combine(a, b) {
  return {
    check: (d) => a.check(d) && b.check(d),
    errors: (d) => {
      const x = a.errors(d), y = b.errors(d);
      if (!x) return y;
      if (!y) return x;
      return x.concat(y);
    },
  };
}

// The JSON entry points under a check, as the runtime has them.
function extendJSON(base, { check, errors }) {
  return {
    validateJSON: base.validateJSON && ((text) => {
      const res = base.validateJSON(text);
      if (!res.valid) return res;
      const p = parse(text);
      if (p.error) return res;
      if (check(p.value)) return res;
      const e = errors(p.value);
      return e && e.length ? { valid: false, errors: e } : { valid: false, errors: [EXT_FALLBACK] };
    }),
    isValidJSON: (text) => {
      if (!base.isValidJSON(text)) return false;
      const p = parse(text);
      return p.error ? true : check(p.value);
    },
  };
}

module.exports = { COMPILED_OPTIONS, prepare, parse, installExtension, extendJSON, EXT_FALLBACK };
