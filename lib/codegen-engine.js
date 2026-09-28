'use strict';

// Everything that turns a schema into JavaScript source: the three code
// generators, the JSON-text scanner, the parse() copy emitter and the
// ahead-of-time bundle methods. index.js registers this with the core;
// lite.js does not, which is what keeps it out of a lite bundle. The last
// three load on first use, as they did when the core required them itself.
module.exports = {
  jsCompiler: require('./js-compiler'),
  installPaths: require('./codegen-paths'),
  scanCompiler: () => require('./scan-compiler'),
  cloneEmit: () => require('./clone-emit'),
  aot: () => require('./aot.js'),
};
