'use strict';

// The full package: the validator core with the code generator registered.
// The core lives in lib/validator-core.js so that ata-validator/lite can load
// it without the code generator; see that file and lib/codegen-engine.js.
const core = require('./lib/validator-core.js');
core._registerCodegen(require('./lib/codegen-engine.js'));
module.exports = core;
