// 2.0 browser entry, work in progress (feat/v2-entry): the small Validator
// with every schema-decided group registered (lib/groups.js), so every
// schema works as it does on the 1.x Validator. The plugin's target, which
// registers only the groups a schema needs, is index.v2.core.mjs.
import small from './lib/validator-small.js';
import groups from './lib/features/groups.js';
export const Validator = small.Validator;
Validator.use(...groups.all);
