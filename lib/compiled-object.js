'use strict';

// lib/compiled.js without the JSON entry points: validate(), isValidObject()
// and Standard Schema, answered as a Validator with default options answers
// them, down to the error objects. A bundler plugin puts this in place of
// `new Validator(schema)` when the code reads errors but never calls
// validateJSON() or isValidJSON(), so the position map those use to frame an
// error in the JSON text (lib/data-position-cache.js and the walk behind it)
// stays out of the bundle: 14.1 to 12.3 KB gzipped for the wrapper.
// tests/test_compiled_parity.js holds it to the full wrapper.
//
// Only for a schema compiledEligible() accepts, and with the schema
// compiledSchemaFor() returns: the one the runtime reads, after normalization.
// Custom error messages stay on the runtime, and so does every option except
// the ones COMPILED_OPTIONS lists. Defaults are applied as a default Validator
// applies them, before any check, with the same code; `useDefaults: false`
// leaves the input as it is, as the runtime then does.

const { LazyRejection, RichRejection, _enrichLazy } = require('./rejections');
const { prepare, installExtension, EXT_FALLBACK } = require('./compiled-common');
const { installStandard } = require('./standard-schema');

const EMPTY_ERRORS = Object.freeze([]);
const VERDICT_DISAGREES = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]),
});

// The fields of a Validator the rejection classes read.
class CompiledState {
  constructor(schema) {
    this._schemaObj = schema;
    this._schemaPositions = undefined;
    this._source = undefined;
    this._mutatesInput = false;
    this._preprocess = null;
  }
}

function fromCompiledObject(mod, schema, options) {
  const { fill, isValid } = prepare(mod, schema, options, 'fromCompiledObject');
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
  };
  installExtension(api, schema, (base, ext) => {
    return {
      // The verdict is the schema's and the check's. A failure lists the
      // schema's errors, then the check's, read when somebody asks.
      validate(data) {
        const r = base.validate(data);
        if (r.valid && ext.check(data)) return r;
        return new ExtendedRejection(r, data, ext.errors);
      },
      isValidObject: (d) => base.isValidObject(d) && ext.check(d),
    };
  });
  // Standard Schema V1, as the runtime Validator hands it out, so a validator
  // the build compiled away still works where the runtime one did (a form
  // library, a router, an RPC layer). The schema it publishes is the one the
  // module was built from, as the runtime reads it.
  installStandard(api, () => schema, (self, value) => self.validate(value));
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

module.exports = { fromCompiledObject };
