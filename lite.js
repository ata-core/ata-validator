'use strict';

// ata-validator/lite: the Validator without the code generator. Every schema
// runs on the interpreted engine, which passes the same official test suite as
// the compiled path and never calls `new Function`, so it also runs under a
// strict Content-Security-Policy. The results are the ones `ata-validator`
// gives: the same verdicts, the same errors. What it leaves out is what needs
// the code generator (parse(), the ahead-of-time bundle methods) and the tools
// no Validator calls (TypeScript generation, the renderers). Made for pages
// where the size of what ships matters more than nanoseconds per call.
const core = require('./lib/validator-core.js');

module.exports = {
  Validator: core.Validator,
  validate: core.validate,
  validateAsync: core.validateAsync,
  parseAsync: core.parseAsync,
  defineSchema: core.defineSchema,
  version: core.version,
};
