// ata-validator/features/standardSchema: Standard Schema V1, the `~standard` property, on the plugin's 2.0 core.
// featuresFor() never names it: whether a validator reaches a Standard Schema consumer is decided where it is used,
// not by its schema. Without it, reading `~standard` on the core throws "ata2: standardSchema, Validator.use(standardSchema)".
import type { Feature } from './index.js';
export declare const standardSchema: Feature<'standardSchema'>;
