// ata-validator/features/patternFallback: the patternFallback option, for a pattern ata cannot show to run in linear time.
import type { Feature } from './index.js';
export declare const patternFallback: Feature<'patternFallback'>;

/** The matcher a `patternFallback` function returns for one pattern. `test` must return a boolean. */
export interface PatternMatcher {
  test(input: string): boolean;
}
/**
 * Called once per pattern outside the linear-time engine when a validator is
 * constructed, with the pattern and the flags the platform RegExp would use
 * (`'u'` where the pattern is valid with it, else `''`).
 */
export type PatternFallbackFunction = (source: string, flags: string) => PatternMatcher;
/**
 * The values of the `patternFallback` option. `'platform'` (the default) runs
 * such a pattern on the platform RegExp, which can backtrack. `'reject'` makes
 * the constructor and `addSchema()` throw, naming the pattern and its
 * location. A function answers for each such pattern. Anything but
 * `'platform'` needs `Validator.use(patternFallback)`.
 */
export type PatternFallback = 'platform' | 'reject' | PatternFallbackFunction;
