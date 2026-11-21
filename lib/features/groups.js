'use strict';
// Every schema-decided group, as the full 2.0 entries register them
// (index.v2.browser.mjs, index.v2.edge.mjs). For a caller of
// lib/validator-small.js that wants the entries' behaviour.
module.exports = {
  all: [
    require('./formats.js').formats,
    require('./uri.js').uri,
    require('./draft7.js').draft7,
    require('./defaults.js').defaults,
    require('./uniqueItems.js').uniqueItems,
    require('./branchCollapse.js').branchCollapse,
  ],
};
