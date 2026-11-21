// 2.0 features a page registers with Validator.use(), work in progress, and
// featuresFor(). Each is also its own export, ata-validator/features/<name>
// (lib/features/<name>.js), and featuresFor() is ata-validator/features;
// importing this module loads every feature.
import _formats from './lib/features/formats.js';
export const formats = _formats.formats;
import _uri from './lib/features/uri.js';
export const uri = _uri.uri;
import _draft7 from './lib/features/draft7.js';
export const draft7 = _draft7.draft7;
import _defaults from './lib/features/defaults.js';
export const defaults = _defaults.defaults;
import _uniqueItems from './lib/features/uniqueItems.js';
export const uniqueItems = _uniqueItems.uniqueItems;
import _branchCollapse from './lib/features/branchCollapse.js';
export const branchCollapse = _branchCollapse.branchCollapse;
import _richErrors from './lib/features/richErrors.js';
export const richErrors = _richErrors.richErrors;
import _verbose from './lib/features/verbose.js';
export const verbose = _verbose.verbose;
import _metaschemas from './lib/features/metaschemas.js';
export const metaschemas = _metaschemas.metaschemas;
import _errorMessages from './lib/features/errorMessages.js';
export const errorMessages = _errorMessages.errorMessages;
import _coerceTypes from './lib/features/coerceTypes.js';
export const coerceTypes = _coerceTypes.coerceTypes;
import _removeAdditional from './lib/features/removeAdditional.js';
export const removeAdditional = _removeAdditional.removeAdditional;
import _codegen from './lib/features/codegen.js';
export const codegen = _codegen.codegen;
export { featuresFor } from './features/index.mjs';
