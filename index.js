'use strict';

// The full package: the validator core with the code generator registered,
// plus the tools no Validator calls (TypeScript generation, renderers, output
// formats). The core lives in lib/validator-core.js and the code generator in
// lib/codegen-engine.js, so that the edge entry (index.edge.js) and
// ata-validator/lite can load the core without it.
const core = require('./lib/validator-core.js');
// The code generator loads on first need, or once the event loop is free,
// not with the package: it is most of what requiring the package parsed. The
// timer is unref'd, so a script that has finished does not stay to load it.
// The loader lives here rather than in the core, which the browser build
// shares and which has no use for it there.
let engine = null;
const loadCodegen = () => {
  if (engine === null) core._registerCodegen(engine = require('./lib/codegen-engine.js'));
  return engine;
};
core._setCodegenLoader(loadCodegen);
const warm = setTimeout(loadCodegen, 0);
if (typeof warm === 'object' && typeof warm.unref === 'function') warm.unref();

// The public names. lib/public-api.js holds the same for index.edge.js; they
// are written out here rather than required so that loading the package in
// Node reads one file fewer (tests/test_edge_entry.js and
// tests/test_esm_exports.js hold the two to the same names).




// The parts no Validator calls: TypeScript generation, the error renderers,
// the spec output format, the retry message for language models, the schema
// description and the suggestion helper. ata-validator/lite leaves them out.
// Each loads its module on first call. None of them is on the path to a first
// validated request, and together they were about a sixth of what requiring
// the package cost.
function toTypeScript (...a) { return require('./lib/ts-gen').toTypeScript(...a); }
function renderPretty (...a) { return require('./lib/render-pretty').renderPretty(...a); }
function renderCompact (...a) { return require('./lib/render-compact').renderCompact(...a); }
function toOutput (...a) { return require('./lib/output-format').toOutput(...a); }
function toRetryMessage (...a) { return require('./lib/retry-message').toRetryMessage(...a); }
function describeSchema (...a) { return require('./lib/describe-schema').describeSchema(...a); }
function renderJSON (...a) { return require('./lib/render-json').renderJSON(...a); }

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
  const { suggestFor } = require('./lib/suggestions');
  const { reprValue } = require('./lib/enrich-error');
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
  require('./lib/diagnostic-source').setDiagnosticSource(errors, { data, mutatesInput: false });
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
