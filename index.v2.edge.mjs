// 2.0 server and edge entry, work in progress: the 2.0 Validator with the
// verdict core as its engine (lib/core/feature.js). A class of its own, so a
// bundle that loads this entry and index.v2.browser.mjs leaves the browser
// entry's Validator on the small engine alone. Its errors carry the rich
// fields without Validator.use(richErrors), as the 1.x Validator's do; the
// browser entry's carry them once that feature is registered.
import small from './lib/validator-small.js';
import core from './lib/core/feature.js';
import rich from './lib/features/rich-errors.js';
export class Validator extends small.Validator {}
Validator.prototype.core = core;
Validator.prototype.rich = rich.richErrors;
