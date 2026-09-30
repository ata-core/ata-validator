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
// Custom error messages stay on the runtime, and so does every option except
// the ones COMPILED_OPTIONS lists. Defaults are applied as a default Validator
// applies them, before any check, with the same code; `useDefaults: false`
// leaves the input as it is, as the runtime then does.

const { LazyRejection, RichRejection, LazyJsonRejection, _enrichLazy } = require('./rejections');
const { COMPILED_OPTIONS, prepare, parse, installExtension, extendJSON, EXT_FALLBACK } = require('./compiled-common');

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

function fromCompiled(mod, schema, options) {
  const { fill, isValid } = prepare(mod, schema, options, 'fromCompiled');
  const self = new CompiledState(schema);
  if (fill) {
    self._mutatesInput = true;
    self._preprocess = fill;
  }
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
  const api = {
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
  installExtension(api, schema, (base, ext) => {
    const json = extendJSON(base, ext);
    return {
      // The verdict is the schema's and the check's. A failure lists the
      // schema's errors, then the check's, read when somebody asks.
      validate(data) {
        const r = base.validate(data);
        if (r.valid && ext.check(data)) return r;
        return new ExtendedRejection(r, data, ext.errors);
      },
      isValidObject: (d) => base.isValidObject(d) && ext.check(d),
      validateJSON: json.validateJSON,
      isValidJSON: json.isValidJSON,
    };
  });
  return api;
}

// validate() under a check, as the runtime reports it (ExtendedRejection in
// validator-core.js): the inner result's errors, then the check's.
class ExtendedRejection {
  constructor(inner, data, collect) {
    this.valid = false;
    this._inner = inner;
    this._data = data;
    this._collect = collect;
    this._errors = null;
  }
  toJSON() {
    return { valid: false, errors: this.errors };
  }
  _ataRaw() {
    const inner = this._inner;
    const more = this._collect(this._data) || [];
    const raw = inner.valid ? more : (typeof inner._ataRaw === 'function' ? inner._ataRaw() : inner.errors).concat(more);
    return raw.length ? raw : [EXT_FALLBACK];
  }
}
Object.defineProperty(ExtendedRejection.prototype, 'errors', {
  enumerable: true,
  configurable: true,
  get() {
    if (this._errors === null) {
      const inner = this._inner;
      const more = this._collect(this._data) || [];
      const all = inner.valid ? more : inner.errors.concat(more);
      this._errors = all.length ? all : [EXT_FALLBACK];
    }
    return this._errors;
  },
});

module.exports = { fromCompiled, COMPILED_OPTIONS };
