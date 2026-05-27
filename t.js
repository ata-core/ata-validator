'use strict';

// CJS entry for `ata-validator/t`. The implementation lives in `lib/t.js`
// so the default entry can lazy-require it for users who never touch the
// builder. Re-export shape matches the `TBuilder` interface in `t.d.ts`.

const t = require('./lib/t');

module.exports = { t, OPTIONAL: t.OPTIONAL };
