'use strict';

// Browser stub: there is no native addon in the browser. Swapped in via the
// package.json `browser` field so bundlers skip native platform probing.

module.exports = function loadNative() {
  return null;
};
