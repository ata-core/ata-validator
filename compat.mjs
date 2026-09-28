import Ata from './compat.js';
// `Ajv` as well, so the named import ajv 8 documents,
// `import { Ajv } from 'ajv'`, changes only in the module name.
export { Ata, Ata as Ajv };
export default Ata;
