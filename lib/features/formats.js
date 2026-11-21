'use strict';
// The built-in format checks but the URI ones, for the 2.0 Validator:
// Validator.use(formats). A schema with a built-in format is refused without
// it (lib/groups.js); one whose formats are all the caller's own, through the
// `formats` option, does not need it.
const { formatChecks } = require('../formats-core');
module.exports = { formats: Object.freeze({ name: 'formats', checks: formatChecks() }) };
