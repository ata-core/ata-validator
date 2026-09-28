'use strict';

// A Validator-shaped object around a module the code generator wrote ahead of
// time: what a bundler plugin puts in place of `new Validator(schema)` when the
// schema is known at build time, so the runtime compiler does not ship. It
// answers validate(), isValidObject(), validateJSON() and isValidJSON() the way
// a Validator built with default options answers them, down to the error
// objects, which come from the same rejection classes the validator core uses.
// tests/test_compiled_parity.js holds that over the official suite.
//
// Only for a schema compiledEligible() accepts, and with the schema
// compiledSchemaFor() returns: the one the runtime reads, after normalization.
// Custom error messages and every option other than the defaults stay on the
// runtime. Defaults are applied as a default Validator applies them, before
// any check, with the same code.

const { LazyRejection, RichRejection, LazyJsonRejection, _enrichLazy } = require('./rejections');
const { buildDefaultsApplier } = require('./defaults');

const VALID_RESULT = Object.freeze({ valid: true, errors: Object.freeze([]) });
const EMPTY_ERRORS = Object.freeze([]);
const VERDICT_DISAGREES = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]),
});

function syntaxRejection(e) {
  return { valid: false, errors: [{ keyword: '__parse__', instancePath: '', schemaPath: '', params: {}, message: 'invalid JSON: ' + e.message }] };
}

// The fields of a Validator the rejection classes read.
class CompiledState {
  constructor(schema) {
    this._schemaObj = schema;
    this._schemaPositions = undefined;
    this._source = undefined;
    this._mutatesInput = false;
    this._preprocess = null;
    this._posCache = null;
  }
  _pos() {
    return this._posCache || (this._posCache = require('./data-position-cache').createCache());
  }
}

function fromCompiled(mod, schema) {
  const self = new CompiledState(schema);
  const fill = buildDefaultsApplier(schema);
  if (fill) {
    self._mutatesInput = true;
    self._preprocess = fill;
  }
  // With defaults, the document is filled in before it is checked, on every
  // entry point, as the runtime does.
  const isValid = fill ? (d) => { fill(d); return mod.isValid(d); } : mod.isValid;
  const errFn = mod.validate;
  // The generated function's own result, rejected: if it says valid where the
  // verdict said no, the disagreement is reported rather than turned into an
  // acceptance, as the core does.
  const raw = (data) => {
    const r = errFn(data);
    return r && r.valid === false ? r : VERDICT_DISAGREES;
  };
  const rich = (data) => new RichRejection(raw(data), data, null, self, schema, _enrichLazy);
  const buildErrors = (data) => rich(data).errors;
  const buildRawErrors = (data) => rich(data)._ataRaw();
  const parse = (text) => {
    try { return { value: JSON.parse(text) }; } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      return { error: e };
    }
  };
  return {
    validate(data) {
      if (isValid(data)) return { valid: true, data, errors: EMPTY_ERRORS };
      // The runtime returns the rich rejection directly when it rewrites input.
      if (fill) return rich(data);
      return new LazyRejection(buildErrors, data, buildRawErrors);
    },
    isValidObject(data) {
      return isValid(data);
    },
    validateJSON(text) {
      const p = parse(text);
      if (p.error) return new LazyJsonRejection(syntaxRejection(p.error), text, self, _enrichLazy);
      if (isValid(p.value)) return VALID_RESULT;
      return new LazyJsonRejection(raw(p.value), text, self, _enrichLazy);
    },
    isValidJSON(text) {
      const p = parse(text);
      return p.error ? false : isValid(p.value);
    },
  };
}

module.exports = { fromCompiled };
