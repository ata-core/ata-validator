// 2.0 browser entry, work in progress (feat/v2-entry): the small Validator
// with every schema-decided group wired in (lib/validator-full.js), so every
// schema works as it does on the 1.x Validator. The plugin's target, which
// registers only the groups a schema needs, is index.v2.core.mjs.
import full from './lib/validator-full.js';
export const Validator = full.Validator;
