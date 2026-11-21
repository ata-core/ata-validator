'use strict';
// The single error a failed anyOf or oneOf reports, built from its closest
// branch (lib/branch-collapse.js), for the 2.0 Validator:
// Validator.use(branchCollapse).
const { _collapse } = require('../branch-collapse');
module.exports = { branchCollapse: Object.freeze({ name: 'branchCollapse', collapse: _collapse }) };
