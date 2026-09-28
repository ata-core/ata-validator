'use strict';

// The full package: the validator core with the code generator registered,
// plus the tools no Validator calls (TypeScript generation, renderers, output
// formats). The core lives in lib/validator-core.js so that
// ata-validator/lite can load it without either.
const core = require('./lib/validator-core.js');

// Everything that turns a schema into JavaScript source: the three code
// generators and the paths built on them, the generated preprocess pass, the
// JSON-text scanner, the parse() copy and the ahead-of-time bundle methods.
// parse() and the bundle methods load on first use.
const installPaths = require('./lib/codegen-paths.js');
core._registerCodegen({
  jsCompiler: require('./lib/js-compiler.js'),
  installPaths,
  compileVerdict: installPaths.compileVerdict,
  installScanner: installPaths.installScanner,
  buildPreprocess: installPaths.buildPreprocess,
  buildParse: (self, decline, extended) => require('./lib/codegen-parse.js')(self, decline, extended),
  aot: () => require('./lib/aot.js'),
});

// The parts no Validator calls: TypeScript generation, the error renderers,
// the spec output format, the retry message for language models, the schema
// description and the suggestion helper. ata-validator/lite leaves them out.
const { toTypeScript } = require('./lib/ts-gen');
const { renderPretty } = require('./lib/render-pretty');
const { renderCompact } = require('./lib/render-compact');
const { toOutput } = require('./lib/output-format');
const { toRetryMessage } = require('./lib/retry-message');
const { describeSchema } = require('./lib/describe-schema');
const { renderJSON } = require('./lib/render-json');
const { suggestFor } = require('./lib/suggestions');
const { reprValue } = require('./lib/enrich-error');
const { setDiagnosticSource: attachDiagnosticSource } = require('./lib/diagnostic-source');

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
  attachDiagnosticSource(errors, { data, mutatesInput: false });
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
