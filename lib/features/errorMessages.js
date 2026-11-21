'use strict';
// The `errorMessage` keyword for the 2.0 Validator: Validator.use(errorMessages).
const { applyErrorMessages } = require('../error-messages');
module.exports = { errorMessages: Object.freeze({ name: 'errorMessage', apply: applyErrorMessages }) };
