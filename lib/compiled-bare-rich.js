'use strict';

// bareRich: the compiled-bare wrapper for a validator that reads ata's own
// errors (`richErrors` left on) and is only ever called, never handed to other
// code: validate() and isValidObject() as lib/compiled-object.js answers them,
// down to the error objects, without the Standard Schema member and the
// extension hook nothing can reach there, and without the option checks the
// bundler plugin already made. A separate entry from lib/compiled-bare.js so
// a bundle with only plain or verdict validators carries no error pipeline.
// tests/test_compiled_bare.js holds it to the runtime.

const { LazyRejection, RichRejection, _enrichLazy } = require('./rejections');

const EMPTY_ERRORS = Object.freeze([]);
const VERDICT_DISAGREES = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]),
});

// The fields of a Validator the rejection classes read.
class CompiledState {
  constructor(schema, fill) {
    this._schemaObj = schema;
    this._schemaPositions = undefined;
    this._source = undefined;
    this._mutatesInput = fill !== null;
    this._preprocess = fill;
  }
}

function bareRich(mod, schema, useDefaults) {
  const fill = useDefaults !== false && typeof mod.applyDefaults === 'function' ? mod.applyDefaults : null;
  const verdict = mod.isValid;
  const isValid = fill ? (d) => { fill(d); return verdict(d); } : verdict;
  const self = new CompiledState(schema, fill);
  const errFn = mod.validate;
  const rich = (data) => {
    const r = errFn(data);
    return new RichRejection(r && r.valid === false ? r : VERDICT_DISAGREES, data, null, self, schema, _enrichLazy);
  };
  const buildErrors = (data) => rich(data).errors;
  const buildRawErrors = (data) => rich(data)._ataRaw();
  return {
    validate(data) {
      if (isValid(data)) return { valid: true, data, errors: EMPTY_ERRORS };
      // The runtime returns the rich rejection directly when it rewrites input.
      if (fill) return rich(data);
      return new LazyRejection(buildErrors, data, buildRawErrors);
    },
    isValidObject: isValid,
  };
}

module.exports = { bareRich };
