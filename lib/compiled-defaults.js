'use strict';

// The runtime's defaults pass, for a module built before modules carried their
// own (ata-validator 1.58.0, when the pass reached behind `$ref`, `allOf` and
// array elements). The browser build maps this file to
// lib/compiled-defaults.browser.js, so a page that wraps a current module does
// not carry the defaults engine twice.
module.exports = require('./defaults').buildDefaultsApplier;
