'use strict';

// The public names of the package, shared by index.js (with the code
// generator) and index.edge.js (without it), so the two entries export the
// same thing.
const core = require('./validator-core.js');



// The parts no Validator calls: TypeScript generation, the error renderers,
// the spec output format, the retry message for language models, the schema
// description and the suggestion helper. ata-validator/lite leaves them out.
// Each loads its module on first call. None of them is on the path to a first
// validated request, and together they were about a sixth of what requiring
// the package cost.
function toTypeScript (...a) { return require('./ts-gen').toTypeScript(...a); }
function renderPretty (...a) { return require('./render-pretty').renderPretty(...a); }
function renderCompact (...a) { return require('./render-compact').renderCompact(...a); }
function toOutput (...a) { return require('./output-format').toOutput(...a); }
function toRetryMessage (...a) { return require('./retry-message').toRetryMessage(...a); }
function describeSchema (...a) { return require('./describe-schema').describeSchema(...a); }
function renderJSON (...a) { return require('./render-json').renderJSON(...a); }

// Walk a JSON pointer (RFC 6901 escapes) into a data tree. Mirrors the helper
// inside lib/suggestions.js, kept local to avoid exporting an internal.
function _walkPointer (root, pointer) {
  if (!pointer) return root;
  const parts = pointer.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = root;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

// Post-hoc suggestion enrichment for AOT-compiled validators. The standalone
// modules do not embed the suggestion engine, so consumers who want
// suggestions pass the error array through this after validation.
function attachSuggestions (errors, data) {
  if (!errors) return errors;
  const { suggestFor } = require('./suggestions');
  const { reprValue } = require('./enrich-error');
  for (const e of errors) {
    if (!e || e.suggestion) continue;
    let received = e.received;
    if (received === undefined && data !== undefined) {
      const ptr = e.instancePath != null ? e.instancePath : (e.path || '');
      const raw = _walkPointer(data, ptr);
      if (raw !== undefined || ptr === '') received = reprValue(raw);
    }
    const probe = received !== undefined && e.received === undefined
      ? Object.assign({}, e, { received })
      : e;
    const s = suggestFor(probe, data);
    if (s) e.suggestion = s;
  }
  // AOT modules import nothing, so this is their only route to a frame. The
  // caller holds the original object and ran no preprocessing through here.
  require('./diagnostic-source').setDiagnosticSource(errors, { data, mutatesInput: false });
  return errors;
}

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
  toTypeScript,
  defineSchema: core.defineSchema,
  renderPretty,
  renderCompact,
  toOutput,
  toRetryMessage,
  describeSchema,
  renderJSON,
  attachSuggestions, // internal: used by the renderers; not public API
};
