'use strict';

// Locate and load the optional native addon (pkg-prebuilds). Lives in its own
// module so the default and browser entries can stay free of `pkg-prebuilds`,
// `__dirname`, and `path` references. In browser bundles this file is replaced
// with `native-load.browser.js` via the package.json `browser` field, so the
// `pkg-prebuilds` import never enters the bundle in the first place.
//
// Returns the loaded native binding object, or `null` if no prebuild matches
// (musl/Alpine, unsupported arch, devs running before `npm run build`, etc.).
// The JS codegen path covers all core validation when this returns null.

module.exports = function loadNative() {
  try {
    const path = require('path');
    const pkg = require('pkg-prebuilds');
    return pkg(path.join(__dirname, '..'), require('../binding-options'));
  } catch {
    return null;
  }
};
