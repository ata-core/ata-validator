'use strict';
// removeAdditional for the 2.0 Validator: Validator.use(removeAdditional).
// Keys are matched against patternProperties with the engine the Validator
// hands over, as its own patterns compile: lib/engine-shared.js on the full
// entries, and lib/engine-shared-core.js with the patterns feature's engine
// (`safe`, null without it, and then a name that needs it is refused) on the
// plugin's core. The feature carries no pattern engine of its own.
const { buildRemover } = require('../mutators');
module.exports = { removeAdditional: Object.freeze({ name: 'removeAdditional', build: (schema, safe, engine) => buildRemover(schema, (src) => engine.compilePattern(src, safe)) }) };
