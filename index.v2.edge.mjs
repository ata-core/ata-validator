// 2.0 server and edge entry, work in progress: the 2.0 Validator with the
// verdict core as its engine (lib/core/feature.js). A page loads
// index.v2.browser.mjs instead, which carries the small engine alone.
import small from './lib/validator-small.js';
import core from './lib/core/feature.js';
small.Validator.core = core;
export const Validator = small.Validator;
