// 2.0 server and edge entry, work in progress: the 2.0 Validator with the
// verdict core as its engine (lib/core/feature.js). A class of its own, so a
// bundle that loads this entry and index.v2.browser.mjs leaves the browser
// entry's Validator on the small engine alone. As on the browser entry, the
// rich error fields and `verbose` come with Validator.use(richErrors) and
// Validator.use(verbose); every schema-decided group (lib/groups.js) is
// registered.
import small from './lib/validator-small.js';
import core from './lib/core/feature.js';
import groups from './lib/features/groups.js';
export class Validator extends small.Validator {}
Validator.prototype.core = core;
Validator.use(...groups.all);
