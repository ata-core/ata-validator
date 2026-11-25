'use strict';

// require() form of the 2.0 browser entry (index.v2.browser.mjs): the same
// class from the same file, so a bundle that reaches the package through
// both `import` and `require` holds one Validator and one set of features.
exports.Validator = require('./lib/validator-full.js').Validator;
