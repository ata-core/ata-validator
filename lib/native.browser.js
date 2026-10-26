'use strict';

// Browser build of lib/native-message.js, lib/native-codes.js and
// lib/native-positions.js, one file for all three so a page carries one module
// for them: there is no native engine in a browser (lib/native-load.browser.js
// returns null), so no error arrives without a message or with a native
// ordinal, and no position is found by the addon. Kept total all the same.
const message = (err) => (err && err.message) || 'validation failed';
message.fromNative = message.nativeTargeted = () => null;
message.NATIVE_KEYWORDS = [];
module.exports = message;
