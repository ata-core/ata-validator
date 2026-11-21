'use strict';
// removeAdditional for the 2.0 Validator: Validator.use(removeAdditional).
// Keys are matched against patternProperties with the 2.0 engine's pattern
// compile (lib/engine-shared.js, the interpreted engine's code).
const { buildRemover } = require('../mutators');
module.exports = { removeAdditional: Object.freeze({ name: 'removeAdditional', build: (schema) => buildRemover(schema, require('../engine-shared').compilePattern) }) };
