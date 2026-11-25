// ata-validator/features: featuresFor() and the shape of a feature.

/** The name of a feature, as ata-validator/features/<name> exports it. */
export type FeatureName = 'formats' | 'uri' | 'draft7' | 'defaults' | 'uniqueItems' | 'branchCollapse' | 'patterns' | 'richErrors' | 'verbose' | 'metaschemas' | 'errorMessages' | 'coerceTypes' | 'removeAdditional' | 'codegen' | 'standardSchema' | 'patternFallback' |
  'formatEmail' | 'formatDate' | 'formatDateTime' | 'formatTime' | 'formatDuration' | 'formatUuid' | 'formatIpv4' | 'formatIpv6' | 'formatHostname' | 'formatRegex' | 'formatJsonPointer' | 'formatRelativeJsonPointer' | 'formatUriTemplate' | 'formatIdnEmail' | 'formatIdnHostname' | 'formatUri' | 'formatUriReference' | 'formatIri' | 'formatIriReference';

/** A feature for the 2.0 Validator's Validator.use(). Its contents are internal. */
export interface Feature<N extends FeatureName = FeatureName> {
  readonly name: string;
  readonly __feature?: N;
}

/**
 * The features a 2.0 Validator built from `schema` with `options`, and given
 * `schemas` through addSchema(), needs registered, by export name. Throws
 * where any Validator would refuse the schema for another reason.
 *
 * It never names standardSchema: a schema does not say whether its validator
 * is handed to a Standard Schema consumer, so a caller that hands one over
 * (the build plugin, from where the validator goes) registers it itself.
 */
export declare function featuresFor(schema: unknown, options?: Record<string, unknown>, schemas?: readonly unknown[]): FeatureName[];

/**
 * The smallest list of features that covers every check the given lists
 * register: for a page with several validators, featuresFor() of each joined.
 * A formats or uri group in any list stays and the per-name format features
 * it holds go; formats without their group present are named one by one or
 * as their group, whichever adds fewer bytes to a page, by the same measured
 * table featuresFor() reads. For a single schema,
 * joinFeatures(featuresFor(schema)) equals featuresFor(schema).
 */
export declare function joinFeatures(...sets: ReadonlyArray<readonly FeatureName[]>): FeatureName[];
