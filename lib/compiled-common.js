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

module.exports = { COMPILED_OPTIONS, prepare, parse };
