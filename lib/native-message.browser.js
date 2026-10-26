'use strict';

// Browser build of lib/native-message.js: there is no native engine in a
// browser, so no error arrives without a message. Kept total all the same.
module.exports = (err) => (err && err.message) || 'validation failed';
