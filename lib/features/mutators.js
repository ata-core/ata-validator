'use strict';
// coerceTypes and removeAdditional for the 2.0 Validator:
// Validator.use(coerceTypes), Validator.use(removeAdditional).
const { buildCoercer, buildRemover } = require('../mutators');
module.exports = {
  coerceTypes: Object.freeze({ name: 'coerceTypes', build: buildCoercer }),
  // Keys are matched against patternProperties with the 2.0 engine's pattern
  // compile (lib/engine-shared.js, the interpreted engine's code).
  removeAdditional: Object.freeze({ name: 'removeAdditional', build: (schema) => buildRemover(schema, require('../engine-shared').compilePattern) }),
};
