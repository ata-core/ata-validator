// ESM entry for `ata-validator/t`. Re-exports the builder from the CJS
// implementation so there is one source of truth.

import mod from './t.js';
export const { t, OPTIONAL } = mod;
export default mod;
