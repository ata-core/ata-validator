'use strict';

// The browser has no native engine; see lib/native-attach.js.
function attachNative() {}
// Unreachable without an addon; validator-core returns before it.
attachNative.installFast = function installFast() {};
module.exports = attachNative;
