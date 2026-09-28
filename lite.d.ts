// ata-validator/lite: the same Validator and one-shot functions as
// ata-validator, on the interpreted engine and without the code generator.
// Validator#parse and the static bundle methods throw a TypeError here.
export {
  Validator,
  validate,
  validateAsync,
  parseAsync,
  defineSchema,
  version,
} from './index.js';
export type * from './index.js';
