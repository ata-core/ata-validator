'use strict';

// Browser stub: there is no native addon in the browser. Swapped in via the
// package.json `browser` field so bundlers never resolve `pkg-prebuilds`.

module.exports = function loadNative() {
  return null;
};
