'use strict';

// The full package: the validator core with the code generator registered,
// plus the tools no Validator calls (TypeScript generation, renderers, output
// formats). The core lives in lib/validator-core.js so that
// ata-validator/lite can load it without either; see lib/codegen-engine.js
// and lib/extras.js.
const core = require('./lib/validator-core.js');
core._registerCodegen(require('./lib/codegen-engine.js'));
const extras = require('./lib/extras.js');

module.exports = {
  Validator: core.Validator,
  compile: core.compile,
  validate: core.validate,
  validateAsync: core.validateAsync,
  parseAsync: core.parseAsync,
  version: core.version,
  createPaddedBuffer: core.createPaddedBuffer,
  SIMDJSON_PADDING: core.SIMDJSON_PADDING,
  parseJSON: core.parseJSON,
  toTypeScript: extras.toTypeScript,
  defineSchema: core.defineSchema,
  renderPretty: extras.renderPretty,
  renderCompact: extras.renderCompact,
  toOutput: extras.toOutput,
  toRetryMessage: extras.toRetryMessage,
  describeSchema: extras.describeSchema,
  renderJSON: extras.renderJSON,
  attachSuggestions: extras.attachSuggestions, // internal: used by the renderers; not public API
};
