'use strict';
// Filling in `default` values before the check (lib/defaults.js, as its copy
// lib/defaults-core.js), for the 2.0 Validator: Validator.use(defaults). A
// schema whose text names `default`, or that reaches a registered document
// through a reference the pass follows, is refused without it unless
// `useDefaults` is false. A patternProperties name that needs the linear
// pattern engine finds the one the Validator registered (the patterns
// feature), and is refused without it.
module.exports = { defaults: Object.freeze(Object.assign({ name: 'defaults' }, require('../defaults-core'))) };
