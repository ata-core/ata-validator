'use strict';
// The rewrites that read a draft-07, draft-06, draft-04 or 2019-09 schema as
// the engine reads 2020-12, and the removal of format checks under
// `assertFormat: false` (lib/draft7.js), for the 2.0 Validator:
// Validator.use(draft7). A schema the scan says has something to rewrite is
// refused without it (lib/schema-scan.js).
module.exports = { draft7: Object.freeze(Object.assign({ name: 'draft7' }, require('../draft7'), require('../format-off'))) };
