'use strict';

// What a 2.0 page loads when one of its validators gets hot (see
// lib/validator-small.js): the full Validator with the code generator. The
// small Validator hands its calls to one built here from the same schema and
// options, which answers the same on generated code.
const core = require('./validator-core.js');
if (!core._codegenRegistered()) core._registerCodegen(require('./codegen-engine.js'));
module.exports = { full: (schema, opts) => new core.Validator(schema, opts) };
