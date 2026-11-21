// 2.0 features a page registers with Validator.use(), work in progress, and
// featuresFor(). Each is also its own export, ata-validator/features/<name>,
// and featuresFor() is ata-validator/features; importing this module loads
// every feature.
export { formats } from './features/formats.mjs';
export { uri } from './features/uri.mjs';
export { draft7 } from './features/draft7.mjs';
export { defaults } from './features/defaults.mjs';
export { uniqueItems } from './features/uniqueItems.mjs';
export { branchCollapse } from './features/branchCollapse.mjs';
export { richErrors } from './features/richErrors.mjs';
export { verbose } from './features/verbose.mjs';
export { metaschemas } from './features/metaschemas.mjs';
export { errorMessages } from './features/errorMessages.mjs';
export { coerceTypes } from './features/coerceTypes.mjs';
export { removeAdditional } from './features/removeAdditional.mjs';
export { codegen } from './features/codegen.mjs';
export { featuresFor } from './features/index.mjs';
