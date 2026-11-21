// ata-validator/features: featuresFor() and the shape of a feature.

/** The name of a feature, as ata-validator/features/<name> exports it. */
export type FeatureName = 'formats' | 'uri' | 'draft7' | 'defaults' | 'uniqueItems' | 'branchCollapse' | 'richErrors' | 'verbose' | 'metaschemas' | 'errorMessages' | 'coerceTypes' | 'removeAdditional' | 'codegen';

/** A feature for the 2.0 Validator's Validator.use(). Its contents are internal. */
export interface Feature<N extends FeatureName = FeatureName> {
  readonly name: string;
  readonly __feature?: N;
}

/**
 * The features a 2.0 Validator built from `schema` with `options`, and given
 * `schemas` through addSchema(), needs registered, by export name. Throws
 * where any Validator would refuse the schema for another reason.
 */
export declare function featuresFor(schema: unknown, options?: Record<string, unknown>, schemas?: readonly unknown[]): FeatureName[];
