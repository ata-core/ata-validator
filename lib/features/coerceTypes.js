'use strict';
// coerceTypes for the 2.0 Validator: Validator.use(coerceTypes).
const { buildCoercer } = require('../mutators');
module.exports = { coerceTypes: Object.freeze({ name: 'coerceTypes', build: buildCoercer }) };
