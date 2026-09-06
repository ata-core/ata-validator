'use strict';

// Node resolution of the AOT emitters. Browser bundles swap this file for
// `lib/aot.browser.js` via the package.json `browser` field, so the default
// browser bundle carries no emitters and no embedded safe-regex source; a
// page that wants to emit validators imports `ata-validator/aot`, which
// reaches `lib/aot-impl.js` directly and works without `fs`.
module.exports = require('./aot-impl.js');
