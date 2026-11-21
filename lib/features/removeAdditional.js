'use strict';
// removeAdditional for the 2.0 Validator: Validator.use(removeAdditional).
// Keys are matched against patternProperties with the matcher the Validator
// hands over: its engine's pattern compile (lib/engine-shared.js on the full
// entries, lib/engine-shared-core.js with the patterns feature's engine on the
// plugin's core), so the feature carries no pattern engine of its own.
const { buildRemover } = require('../mutators');
module.exports = { removeAdditional: Object.freeze({ name: 'removeAdditional', build: (schema, patternOf) => buildRemover(schema, patternOf) }) };
