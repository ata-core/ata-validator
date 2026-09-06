import { Validator, JSONSchema } from './index';

/** Options accepted by the standalone emitters. See docs/aot.md. */
export interface StandaloneOptions {
  /** Module format for the emitted source. Default: 'esm'. */
  format?: 'esm' | 'cjs';
  /** Use stub error functions for the smallest output. Default: false. */
  abortEarly?: boolean;
  [key: string]: unknown;
}

/** The constructor of Validator, as the emitters take it explicitly. */
export type ValidatorClass = typeof Validator;

/** Emit one standalone module's source for one validator, or null when the
 * schema compiled through an engine that has no source form. */
export function toStandalone(validator: Validator<unknown>): string | null;

/** Emit one standalone module (no runtime dependency) for one validator. */
export function toStandaloneModule(validator: Validator<unknown>, opts?: StandaloneOptions): string;

/** Emit a module of per-schema compiled validators that `loadBundle` consumes. */
export function bundle(V: ValidatorClass, schemas: ReadonlyArray<JSONSchema | boolean | object>, opts?: StandaloneOptions): string;

/** Emit one self-contained module for many schemas, zero runtime dependency. */
export function bundleStandalone(V: ValidatorClass, schemas: ReadonlyArray<JSONSchema | boolean | object>, opts?: StandaloneOptions): string;

/** Like bundleStandalone with shared helpers deduplicated across schemas. */
export function bundleCompact(V: ValidatorClass, schemas: ReadonlyArray<JSONSchema | boolean | object>, opts?: StandaloneOptions): string;

/** Turn the modules a bundle produced back into Validator instances. */
export function loadBundle(
  V: ValidatorClass,
  mods: Array<unknown>,
  schemas: ReadonlyArray<JSONSchema | boolean | object>,
  opts?: object,
): Array<Validator<unknown>>;
