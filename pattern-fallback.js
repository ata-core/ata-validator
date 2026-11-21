'use strict';

// ata-validator/pattern-fallback: adds the patternFallback option to a bundle
// for a page or a Worker (the browser build, the edge entry,
// ata-validator/lite), which leave it out so a bundle that does not use it
// does not carry it. Import it once, before building a validator with the
// option. On Node, ata-validator has the option already.
const core = require('./lib/validator-core.js');
const patternFallback = require('./lib/pattern-fallback.js');
core._internals._registerPatternFallback(() => patternFallback);
module.exports = {};
