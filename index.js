'use strict';

// The full package: the validator core with the code generator registered,
// plus the tools no Validator calls (TypeScript generation, renderers, output
// formats). The core lives in lib/validator-core.js and the code generator in
// lib/codegen-engine.js, so that the edge entry (index.edge.js) and
// ata-validator/lite can load the core without it.
const core = require('./lib/validator-core.js');
core._registerCodegen(require('./lib/codegen-engine.js'));

module.exports = require('./lib/public-api.js');
