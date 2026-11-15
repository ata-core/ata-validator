'use strict';
// The official meta-schemas, for a schema that references one:
// Validator.use(metaschemas).
const { METASCHEMAS } = require('../metaschemas');
module.exports = { metaschemas: Object.freeze({ name: 'metaschemas', map: METASCHEMAS }) };
