'use strict';

// bareStandard: the compiled-module wrapper for a validator that is only ever
// handed to a Standard Schema consumer (a router's validator middleware, a
// form library, an RPC layer) and never called by its own code. Such a
// consumer reads `~standard` and nothing else, and an issue carries a message
// and a path, so the wrapper is built on a module written with
// `plainErrors: true`, whose errors are those two things in schema order, and
// carries no error pipeline, no Standard Schema install and no extension hook.
// The issues are the runtime's (tests/test_compiled_standard.js). A bundler
// plugin puts this in place of `new Validator(schema)` where it sees that use.

const { standardSchemaFor } = require('./standard-schema');

const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) });
// When the module's error function answers valid where its verdict said no,
// the disagreement is reported rather than turned into an acceptance.
const VERDICT_DISAGREES = Object.freeze({ valid: false, errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]) });

function bareStandard(mod, schema, useDefaults) {
  const fill = useDefaults !== false && typeof mod.applyDefaults === 'function' ? mod.applyDefaults : null;
  const isValid = mod.isValid;
  const errFn = mod.validate;
  const validate = (data) => {
    if (fill !== null) fill(data);
    if (isValid(data)) return VALID;
    const r = errFn(data);
    return r && r.valid === false ? r : VERDICT_DISAGREES;
  };
  return { '~standard': standardSchemaFor(null, () => schema, (_, value) => validate(value)) };
}

module.exports = { bareStandard };
