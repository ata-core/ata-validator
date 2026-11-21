'use strict';
// Filling in `default` values before the check (lib/defaults.js), for the
// 2.0 Validator: Validator.use(defaults). A schema whose text names
// `default`, or that reaches a registered document through a reference the
// pass follows, is refused without it unless `useDefaults` is false.
const { buildDefaultsApplier } = require('../defaults');
module.exports = { defaults: Object.freeze({ name: 'defaults', build: buildDefaultsApplier }) };
