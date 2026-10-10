import { Validator, JSONSchema } from './index';

/** Options accepted by the standalone emitters. See docs/aot.md. */
export interface StandaloneOptions {
  /** Module format for the emitted source. Default: 'esm'. */
  format?: 'esm' | 'cjs';
  /** Use stub error functions for the smallest output. Default: false. */
  abortEarly?: boolean;
  /**
   * Also export `parse(data)`: validate, then return a copy of the input
   * holding only the properties the schema declares. Default: false.
   */
  parse?: boolean;
  [key: string]: unknown;
}

/** The constructor of Validator, as the emitters take it explicitly. */
export type ValidatorClass = typeof Validator;

/** Emit one standalone module's source for one validator, or null when the
 * schema compiled through an engine that has no source form. */
export function toStandalone(validator: Validator<unknown>): string | null;

/** Emit one standalone module (no runtime dependency) for one validator. */
export function toStandaloneModule(validator: Validator<unknown>, opts?: StandaloneOptions): string;

/** Options of toCompactModule. */
export interface CompactModuleOptions {
  /** Import specifier of the error runtime the module takes its errors from. */
  errorRuntime: string;
  /** Module format for the emitted source. Default: 'esm'. */
  format?: 'esm' | 'cjs';
  [key: string]: unknown;
}

/**
 * Emit a compact module: the verdict function and the schema without its
 * descriptive keywords, with error detail from the shared runtime at
 * `opts.errorRuntime` (see errorRuntimeSource). The errors are the ones the
 * runtime Validator reports with `richErrors: false`, in its order, and
 * `errorMessage` is not applied, as in toStandaloneModule. Null when the validator depends on
 * something outside its schema (custom keywords or formats, registered
 * schemas, options other than the defaults); write the self-contained module
 * then. `ata build` makes this choice by itself.
 */
export function toCompactModule(validator: Validator<unknown>, opts: CompactModuleOptions): string | null;

/** Why a validator cannot be written as a compact module, or null when it can. */
export function compactDecline(validator: Validator<unknown>): string | null;

/**
 * Emit a schema module: the schema without its descriptive keywords and a few
 * lines; the verdict and the errors come from the runtime at `opts.runtime`
 * (errorRuntimeSource with `schemaMode`). Far smaller and quicker to load than
 * generated code, about five times slower per check once warm. Answers as the
 * runtime Validator does with `richErrors: false`. Null where
 * toCompactModule would be null. `ata build --mode schema` writes these.
 */
export function toSchemaModule(validator: Validator<unknown>, opts: { runtime: string; registry?: string; format?: 'esm' | 'cjs' }): string | null;

/**
 * Source of the registry module schema modules import when their schemas
 * reference each other by `$id`: the schemas, without descriptive keywords,
 * as one array. Pass its import specifier as `registry` to toSchemaModule,
 * for a validator built with those schemas in its `schemas` option; the module
 * then names its schema by `$id` and carries no copy of it. `ata build --mode
 * schema` does this for inputs that reference each other.
 */
export function registrySource(schemas: ReadonlyArray<object | Validator<unknown>>, format?: 'esm' | 'cjs'): string;

/** Source of the runtime compact modules (and, with `schemaMode`, schema
 * modules) import. With `schemas`, the validators or schemas whose modules
 * will import it, parts none of them needs are left out. Node only: it is put
 * together from the library's files. */
export function errorRuntimeSource(format?: 'esm' | 'cjs', schemas?: ReadonlyArray<unknown> | null, schemaMode?: boolean): string;

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
