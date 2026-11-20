// 2.0 features a page registers with Validator.use(), work in progress (feat/v2-entry).
import em from './lib/features/error-messages.js';
import ms from './lib/features/metaschemas.js';
export const errorMessages = em.errorMessages;
export const metaschemas = ms.metaschemas;
import mu from './lib/features/mutators.js';
export const coerceTypes = mu.coerceTypes;
export const removeAdditional = mu.removeAdditional;
import cg from './lib/features/codegen.js';
export const codegen = cg.codegen;
import re from './lib/features/rich-errors.js';
export const richErrors = re.richErrors;
