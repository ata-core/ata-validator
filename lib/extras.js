'use strict';

// The parts of the package no Validator calls: TypeScript generation, the
// error renderers, the spec output format, the retry message for language
// models, the schema description and the suggestion helper. index.js exports
// them; ata-validator/lite does not, so a lite bundle does not carry them.

const { toTypeScript } = require('./ts-gen');
const { renderPretty } = require('./render-pretty');
const { renderCompact } = require('./render-compact');
const { toOutput } = require('./output-format');
const { toRetryMessage } = require('./retry-message');
const { describeSchema } = require('./describe-schema');
const { renderJSON } = require('./render-json');
const { suggestFor } = require('./suggestions');
const { reprValue } = require('./enrich-error');
const { setDiagnosticSource: attachDiagnosticSource } = require('./diagnostic-source');

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

module.exports = { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON, attachSuggestions };
