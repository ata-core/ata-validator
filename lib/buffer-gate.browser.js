'use strict';

// Browser twin of lib/buffer-gate.js, wired by the package.json `browser`
// field. The gate exists to route schemas the native walker answers wrongly;
// a browser bundle never loads the native walker, so there is nothing to
// route and the shape list can stay out of the bundle.

module.exports = {
  bufferNeedsSlowPath: () => false,
  // A browser build has no addon, and without Buffer nothing to decode
  // with. A polyfilled Buffer gets the second message: fail loudly rather
  // than return with the methods still uninstalled.
  installBufferApis(self, name) {
    if (typeof Buffer === 'undefined') throw new Error(`Native addon required for ${name}(). Use validate(), isValidObject() or validateJSON(), which do not need it.`);
    throw new Error('The buffer APIs are not available in the browser build. Use validate(), isValidObject() or validateJSON().');
  },
};
