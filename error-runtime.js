'use strict';

// ata-validator/error-runtime: the error runtime compact modules import, for a
// bundler plugin that writes compact modules into the application's own
// bundle. The bundler then keeps one copy, shared with ata-validator/compiled
// where both are used. `ata build` writes the same runtime as a file instead
// (errorRuntimeSource in ata-validator/aot).
const { createErrors: create } = require('./lib/error-runtime-entry.js');
const { codeOf } = require('./lib/error-code-of.js');
const ataVersion = require('./lib/version.js');

function createErrors(schema, options) {
  return create(schema, codeOf, options);
}

// The linear-time pattern engine, which a compact module imports from here
// instead of embedding its own copy.
let _safe = null;
function compileSafe(src) {
  if (_safe === null) _safe = require('./lib/safe-regex.js').compileSafe;
  return _safe(src);
}

module.exports = { createErrors, compileSafe, ataVersion };
