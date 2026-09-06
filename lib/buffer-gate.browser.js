'use strict';

// Browser twin of lib/buffer-gate.js, wired by the package.json `browser`
// field. The gate exists to route schemas the native walker answers wrongly;
// a browser bundle never loads the native walker, so there is nothing to
// route and the shape list can stay out of the bundle. index.js only consults
// the gate when the native addon loaded, which it never does here, so these
// are unreachable, kept callable for safety.

module.exports = {
  bufferNeedsSlowPath: () => false,
  installSlowBufferApis() {},
};
