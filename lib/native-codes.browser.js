'use strict';

// Browser build of lib/native-codes.js: there is no native engine in a
// browser, so no error arrives with a native ordinal (an error code is a
// number only when the addon wrote it). Kept total all the same.
module.exports = { fromNative: () => null, NATIVE_KEYWORDS: [] };
