'use strict';

// ata-validator/error-runtime: the error runtime compact modules import, for a
// bundler plugin that writes compact modules into the application's own
// bundle. The bundler then keeps one copy, shared with ata-validator/compiled
// where both are used. `ata build` writes the same runtime as a file instead
// (errorRuntimeSource in ata-validator/aot).
const core = require('./lib/error-runtime-core.js');

// The defaults pass a compact module's applyDefaults asks for, built from the
// schema the module embeds (lib/defaults.js, the closure pass the runtime
// Validator uses where its generated pass declines). A module used to carry
// the pass as its own generated code, 108 KB for a schema whose defaults are
// large. A function that fills nothing where the schema declares no default.
function createDefaults(schema) {
  return require('./lib/defaults.js').buildDefaultsApplier(schema) || function () {};
}

module.exports = { ...core, createDefaults };
