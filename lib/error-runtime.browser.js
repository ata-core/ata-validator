'use strict';

// Browser twin of lib/error-runtime.js, wired by the package.json `browser`
// field. The shared error runtime is put together from the library's own
// files with fs, which a build tool does and a page does not; the emitters a
// page can call (bundleStandalone, toStandaloneModule) never need it. Pulling
// fs into a browser bundle stopped esbuild outright and left Vite with an
// empty stand-in.
const { runtimeFeatures, codeTable } = require('./error-runtime-features');

function errorRuntimeSource() {
  throw new Error('errorRuntimeSource() reads the library files and runs at build time, not in a browser');
}

module.exports = { errorRuntimeSource, runtimeFeatures, codeTable };
