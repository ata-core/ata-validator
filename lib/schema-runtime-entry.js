'use strict';

// The runtime a schema module (`ata build --mode schema`) imports: the verdict
// and the errors both come from the interpreted engine walking the embedded
// schema, so a module is its schema and a few lines. Smaller and quicker to
// load than generated code, slower per check once warm; see docs/API.md.
// One interpreter per schema answers both, so the schema is prepared once.
// It loads lib/interpreter.js, which brings the plan compiler for schemas
// used often (TIER in lib/interpreter-core.js).
const { createInterpreter } = require('./interpreter');
const { errorsOf, interpreterOptions } = require('./error-runtime-entry');

function createValidator(schema, codeOf, options) {
  const interp = createInterpreter(schema, interpreterOptions(options));
  return {
    isValid: (data) => interp.isValid(data),
    errors: (data) => errorsOf(interp, schema, codeOf, data),
  };
}

module.exports = { createValidator };
