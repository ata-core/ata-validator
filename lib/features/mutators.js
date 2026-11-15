'use strict';
// coerceTypes and removeAdditional for the 2.0 Validator:
// Validator.use(coerceTypes), Validator.use(removeAdditional).
const { buildCoercer, buildRemover } = require('../mutators');
module.exports = {
  coerceTypes: Object.freeze({ name: 'coerceTypes', build: buildCoercer }),
  removeAdditional: Object.freeze({ name: 'removeAdditional', build: buildRemover }),
};
