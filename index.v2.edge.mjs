// 2.0 edge entry, what the `workerd` and `edge-light` conditions resolve: the 2.0 Validator with the
// verdict core as its engine (lib/core/feature.js). A class of its own, so a
// bundle that loads this entry and index.v2.browser.mjs leaves the browser
// entry's Validator on the small engine alone. As on the browser entry, the
// rich error fields and `verbose` come with Validator.use(richErrors) and
// Validator.use(verbose); every schema-decided group is wired in
// (lib/validator-full.js).
import full from './lib/validator-full.js';
import core from './lib/core/feature.js';
export class Validator extends full.Validator {}
Validator.prototype.core = core;
