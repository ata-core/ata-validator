'use strict';
// The official meta-schemas, for a schema that references one:
// Validator.use(metaschemas).
const { METASCHEMAS } = require('../metaschemas');

// Registers them in a validator's map of documents (lib/validator-small.js),
// each under every spelling of its id: with and without the trailing `#`,
// http and https. An entry the caller registered under one of them stays.
// Kept here and not in the Validator, so a page that does not register the
// feature does not carry it.
function add(map) {
  for (const [id, meta] of METASCHEMAS) {
    const bare = id.replace(/#$/, '');
    for (const key of [id, bare, bare + '#', bare.replace(/^https:/, 'http:'), bare.replace(/^http:/, 'https:')]) if (!map.has(key)) map.set(key, meta);
  }
}

module.exports = { metaschemas: Object.freeze({ name: 'metaschemas', map: METASCHEMAS, add }) };
