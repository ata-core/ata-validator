'use strict';

// The compiled-module wrapper for `new Validator(schema, { richErrors: false })`:
// validate(), isValidObject() and Standard Schema, answered as such a
// Validator answers them, errors in its plain shape (keyword, instancePath,
// schemaPath, params, message). The module is written with `plainErrors: true`
// (compiledModuleFor in ata-validator/build), so its errors are already that
// shape and in that order, and this wrapper hands them out as they are: no
// rejection classes, no enrichment, no suggestions. 2.6 KB gzipped against
// 10.9 for the rich wrapper without JSON entry points.
// tests/test_compiled_plain.js holds it to the runtime over the suite.

const { prepare, installExtension, EXT_FALLBACK } = require('./compiled-common');
const { installStandard } = require('./standard-schema');

const EMPTY_ERRORS = Object.freeze([]);
// The module's own verdict and its error function disagree (the data changed
// between them): reported, never turned into an acceptance, as the core does.
const VERDICT_DISAGREES = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]),
});

function fromCompiledPlain(mod, schema, options) {
  const opts = options ? { ...options } : undefined;
  // `richErrors: false` is what this wrapper is; anything else it is not.
  if (opts) {
    if (opts.richErrors !== false) throw new TypeError('fromCompiledPlain answers `richErrors: false`; a Validator with rich errors takes fromCompiled');
    delete opts.richErrors;
  }
  const { isValid } = prepare(mod, schema, opts, 'fromCompiledPlain');
  const errFn = mod.validate;
  const api = {
    validate(data) {
      if (isValid(data)) return { valid: true, data, errors: EMPTY_ERRORS };
      const r = errFn(data);
      return r && r.valid === false ? { valid: false, errors: r.errors } : VERDICT_DISAGREES;
    },
    isValidObject(data) {
      return isValid(data);
    },
  };
  installExtension(api, schema, (base, ext) => ({
    validate(data) {
      const r = base.validate(data);
      if (r.valid && ext.check(data)) return r;
      const more = ext.errors(data) || [];
      const all = r.valid ? more : r.errors.concat(more);
      return { valid: false, errors: all.length ? all : [EXT_FALLBACK] };
    },
    isValidObject: (d) => base.isValidObject(d) && ext.check(d),
  }));
  installStandard(api, () => schema, (self, value) => self.validate(value));
  return api;
}

module.exports = { fromCompiledPlain };
