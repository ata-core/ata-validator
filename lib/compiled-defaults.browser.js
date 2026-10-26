'use strict';

// Browser build of lib/compiled-defaults.js. A module from ata-validator 1.58.0
// on carries `applyDefaults` when its schema has a default, and the wrapper
// uses it; only an older module needs the runtime's pass, which this build
// leaves out. Such a module is refused rather than run without its defaults.
module.exports = function () {
  throw new TypeError('This compiled module was built before ata-validator 1.58.0 and its schema has defaults; rebuild it to use it in a browser bundle.');
};
