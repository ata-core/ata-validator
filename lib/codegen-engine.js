'use strict';

// Everything that turns a schema into JavaScript source: the three code
// generators and the paths built on them, the generated preprocess pass, the
// JSON-text scanner, the parse() copy and the ahead-of-time bundle methods.
// index.js registers this with the core; lite.js does not, which is what keeps
// it out of a lite bundle. parse() and the bundle methods load on first use, as
// they did when the core required them itself.
const installPaths = require('./codegen-paths');

module.exports = {
  jsCompiler: require('./js-compiler'),
  installPaths,
  compileVerdict: installPaths.compileVerdict,
  installScanner: installPaths.installScanner,
  buildPreprocess: require('./codegen-preprocess'),
  buildParse: (self, decline, extended) => require('./codegen-parse')(self, decline, extended),
  aot: () => require('./aot.js'),
};
