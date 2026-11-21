'use strict';
// The uri, uri-reference, iri and iri-reference format checks, and the walk
// they share (lib/uri-core.js), for the 2.0 Validator: Validator.use(uri).
const checks = require('../uri-checks');
module.exports = { uri: Object.freeze({ name: 'uri', checks }) };
