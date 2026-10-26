'use strict';

// The words for an error the native engine reported without a message (it
// reports numeric codes): the enrich pass knows them. A module of its own so
// the browser build, which has no native engine (lib/native-load.browser.js),
// maps it to lib/native-message.browser.js and leaves the enrichment out of
// bundles that only reach it from here, such as ata-validator/compiled-plain.
module.exports = (err) => require('./enrich-error').enrich(err, {}).message;
