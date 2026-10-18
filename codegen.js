'use strict';

// ata-validator/codegen: registers the code generator now. The browser build
// loads it on demand, once a validator gets hot; importing this once at
// startup has every schema compiled to generated code from its first call,
// and makes parse() and the ahead-of-time bundle methods available in the
// browser. On Node, ata-validator already includes it and this does nothing.
const core = require('./lib/validator-core.js');
if (!core._codegenRegistered()) core._registerCodegen(require('./lib/codegen-engine.js'));
module.exports = {};
