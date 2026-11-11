'use strict';

// ata-validator/error-runtime without the defaults pass: what the package's
// ES module entry (error-runtime.mjs) imports, so that a bundle whose
// modules fill no default does not carry lib/defaults.js. The CommonJS entry
// (error-runtime.js) adds createDefaults to this.
const ataVersion = require('./version.js');

// The interpreter and the code table load on the first call, not at import:
// a compact module calls this only when a document it rejected is asked for
// its errors.
function createErrors(schema, options) {
  const { createErrors: create } = require('./error-runtime-entry.js');
  const { codeOf } = require('./error-code-of.js');
  return create(schema, codeOf, options);
}

// The linear-time pattern engine, which a compact module imports from here
// instead of embedding its own copy.
let _safe = null;
function compileSafe(src) {
  if (_safe === null) _safe = require('./safe-regex.js').compileSafe;
  return _safe(src);
}

// The RFC 3986 walk behind the uri, uri-reference, iri and iri-reference
// formats, which a compact module imports from here instead of carrying the
// factory's text; `mode` as lib/uri-core.js reads it.
let _walk = null;
function uriWalk(s, mode) {
  if (_walk === null) _walk = require('./formats.js').uriWalk;
  return _walk(s, mode);
}

// Warm-up, in a browser only: the runtime's code compiles on its first use,
// which a page would otherwise pay for on its first rejected document, about
// a millisecond. When the browser is idle, one small error list is built here
// instead, once, so the first real one finds the code compiled. Nothing it
// does reaches a caller.
const WARM_SCHEMA = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer', minimum: 0 }, c: { anyOf: [{ type: 'string' }, { type: 'null' }] }, f: { type: 'string', format: 'email' } }, required: ['d'], additionalProperties: false };
function warm() { try { createErrors(WARM_SCHEMA, { flat: true })({ a: 1, b: -1, c: 2, f: 'x', e: 0 }); } catch (_) {} }
if (typeof requestIdleCallback === 'function') { try { requestIdleCallback(warm); } catch (_) {} }
// In Node the same happens once the event loop is first free after start-up,
// on a timer that does not keep the process alive: a script that exits at
// once never runs it, and a server has it done before its first request.
else if (typeof process === 'object' && process !== null && process.versions && process.versions.node && typeof setTimeout === 'function') { try { const t = setTimeout(warm, 0); if (t && typeof t.unref === 'function') t.unref(); } catch (_) {} }

module.exports = { createErrors, compileSafe, uriWalk, ataVersion };
