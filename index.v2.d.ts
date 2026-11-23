// Types of the 2.0 entries: what `ata-validator` resolves to under the
// `browser`, `workerd` and `edge-light` conditions (index.v2.browser.mjs,
// index.v2.edge.mjs and their require forms). One export, Validator. The
// Node entries are described by index.d.ts, and the same Validator as 1.x
// under every condition by `ata-validator/v1`.

import type { FormatChecker, Infer, JSONSchema, StandardSchemaV1Props, ValidationError, ValidationResult } from './index.js';
import type { Feature } from './features/index.js';

export type { FormatChecker, Infer, JSONSchema, StandardSchemaV1Props, ValidationError, ValidationResult };
export type { Feature, FeatureName } from './features/index.js';

/**
 * The options the 2.0 Validator knows. Any other key whose value is not
 * `undefined` is refused by the constructor with `ata2: option <name>`.
 */
export interface ValidatorOptions {
  /** Needs `Validator.use(coerceTypes)`, from `ata-validator/features/coerceTypes`. */
  coerceTypes?: boolean | 'array';
  /** Needs `Validator.use(removeAdditional)`, from `ata-validator/features/removeAdditional`. */
  removeAdditional?: boolean;
  /** When true (default), missing properties are filled in from their `default` before validation. */
  useDefaults?: boolean;
  /** When true (default), `format` is asserted. Set to false to treat it as an annotation. */
  assertFormat?: boolean;
  schemas?: Record<string, object> | object[];
  /** Custom format checkers, by the name a schema's `format` uses. */
  formats?: Record<string, FormatChecker>;
  /**
   * `parentSchema`, `schema` and `data` on each error. Needs
   * `Validator.use(verbose)`, from `ata-validator/features/verbose`.
   */
  verbose?: boolean;
  /** The URI the schema was retrieved from, for a schema that declares no `$id`. */
  baseURI?: string;
  /** When true, validate() returns a shared frozen result on the first failure. */
  abortEarly?: boolean;
  /**
   * `true` asks for the rich error fields (`code`, `docUrl`, `expected`,
   * `received` and the others) and needs `Validator.use(richErrors)`, from
   * `ata-validator/features/richErrors`. Left out, errors are rich where that
   * feature is registered and have the five plain fields where it is not.
   * `false` gives the plain fields either way.
   */
  richErrors?: boolean;
}

/** Instance surface of the 2.0 Validator. */
export interface Validator<T = unknown> {
  /** Add a schema to the registry for cross-schema `$ref` resolution, before the first call. */
  addSchema(schema: object): void;
  /** Validate data, returns the result with errors. Applies defaults. */
  validate(data: unknown): ValidationResult<T>;
  /** Boolean check, no error collection. */
  isValidObject(data: unknown): data is T;
  /** Validate a JSON string, parsed with JSON.parse. */
  validateJSON(jsonString: string): ValidationResult<T>;
  /** Boolean check for a JSON string. */
  isValidJSON(jsonString: string): boolean;
  /** Standard Schema V1 interface. */
  readonly '~standard': StandardSchemaV1Props<T>;
}

/** Constructor and statics of the 2.0 {@link Validator}. */
export interface ValidatorConstructor {
  /** Construct from a JSON Schema literal; the validated data type is inferred. */
  new <const S extends JSONSchema>(schema: S, options?: ValidatorOptions): Validator<Infer<S>>;
  /** Construct from a plain object or string schema, or with an explicit data type. */
  new <T = unknown>(schema: object | string | boolean, options?: ValidatorOptions): Validator<T>;
  /**
   * Register features for every Validator of the bundle, each imported from
   * `ata-validator/features/<name>`. A validator that needs one that is not
   * registered throws an Error starting with `ata2:` on its first call.
   */
  use(...features: Feature[]): ValidatorConstructor;
  readonly prototype: Validator;
}

export const Validator: ValidatorConstructor;
