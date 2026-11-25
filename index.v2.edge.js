'use strict';

// require() form of the 2.0 server and edge entry (index.v2.edge.mjs): the
// 2.0 Validator with the verdict core as its engine. The class is declared
// here as it is there, so a bundle that reaches the package through both
// `import` and `require` holds two subclasses of one Validator; features
// registered with Validator.use() on either are seen by both, because the
// registry lives in lib/validator-full.js.
const full = require('./lib/validator-full.js');
const core = require('./lib/core/feature.js');
class Validator extends full.Validator {}
Validator.prototype.core = core;
exports.Validator = Validator;
