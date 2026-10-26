'use strict';

// The smallest wrappers around a compiled module, for a validator the bundler
// plugin sees used only through direct calls of its methods: never handed to
// other code, so nothing reads `~standard` or registers a check on it with
// `_extendChecks`, and its options were read at build time. What is left is
// what those calls answer: defaults filled with the module's own pass, the
// verdict, and for `richErrors: false` the module's plain errors as they are.
// The same answers as fromCompiledVerdict and fromCompiledPlain
// (tests/test_compiled_bare.js), without their API surface: 0.3 KB gzipped
// against 1.6 and 2.6.

const EMPTY_ERRORS = Object.freeze([]);
const VERDICT_DISAGREES = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]),
});

function verdictOf(mod, useDefaults) {
  const fill = useDefaults !== false && typeof mod.applyDefaults === 'function' ? mod.applyDefaults : null;
  return fill ? (d) => { fill(d); return mod.isValid(d); } : mod.isValid;
}

// isValidObject() only.
function bareVerdict(mod, useDefaults) {
  return { isValidObject: verdictOf(mod, useDefaults) };
}

// validate() and isValidObject() for `richErrors: false`, around a module
// written with `plainErrors: true`.
function barePlain(mod, useDefaults) {
  const isValid = verdictOf(mod, useDefaults);
  const errFn = mod.validate;
  return {
    validate(data) {
      if (isValid(data)) return { valid: true, data, errors: EMPTY_ERRORS };
      const r = errFn(data);
      return r && r.valid === false ? { valid: false, errors: r.errors } : VERDICT_DISAGREES;
    },
    isValidObject: isValid,
  };
}

module.exports = { bareVerdict, barePlain };
