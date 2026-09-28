'use strict';

// ata-validator/compiled: the wrapper a bundler plugin puts in place of
// `new Validator(schema)` when the schema is known at build time. It takes the
// module `compiledModuleFor(schema)` from ata-validator/build wrote, and answers
// as a default Validator does, without the runtime compiler in the bundle.
module.exports = require('./lib/compiled.js');
