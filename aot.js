'use strict';

// Explicit entry for the AOT emitters, `require('ata-validator/aot')`. In
// Node this is the same module `Validator.bundleStandalone` and friends use.
// In a browser bundle it is the only way to get the emitters: the default
// entry maps them to a stub so pages that never emit code never carry it.
module.exports = require('./lib/aot-impl.js');
