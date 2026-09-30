'use strict';

// ata-validator/compiled-verdict: the wrapper a bundler plugin puts in place of
// `new Validator(schema)` when the schema is known at build time and the code
// only calls isValidObject() or isValidJSON(). It carries no error pipeline;
// code that reads errors gets ata-validator/compiled instead.
module.exports = require('./lib/compiled-verdict.js');
