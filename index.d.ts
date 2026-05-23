export interface ValidationError {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  params: Record<string, unknown>;
  message: string;
  /**
   * The schema object that owns the failing keyword. Populated only when the
   * Validator was constructed with `verbose: true`. Matches ajv's `verbose`
   * behavior.
   */
  parentSchema?: object;
}

export interface SchemaSource {
  file: string;
  line: number;
  col: number;
  text: string;
}

export interface DataFrame {
  byteOffset: number;
  length: number;
  line: number;
  col: number;
  text: string;
}

export interface Suggestion {
  text: string;
  kind: 'typo' | 'format' | 'coercion' | 'similar-key';
}

export type ErrorCode = `ATA${number}`;

export interface RichValidationError {
  code: ErrorCode;
  message: string;
  keyword: string;
  path: string;
  expected?: string;
  received?: string;
  schemaPath?: string;
  schemaSource?: SchemaSource;
  dataFrame?: DataFrame;
  suggestion?: Suggestion;
  docUrl?: string;
  // Back-compat aliases retained indefinitely
  instancePath?: string;
  dataPath?: string;
  params?: Record<string, unknown>;
  parentSchema?: unknown;
}

export interface RenderOptions {
  color?: 'auto' | 'always' | 'never';
  cwd?: string;
}

export interface PrettyOptions extends RenderOptions {
  maxErrors?: number;
}

export interface CompactOptions extends RenderOptions {}

export interface JSONRenderOptions {
  pretty?: boolean;
}

export function renderPretty(errors: RichValidationError[], opts?: PrettyOptions): string;
export function renderCompact(errors: RichValidationError[], opts?: CompactOptions): string;
export function renderJSON(errors: RichValidationError[], opts?: JSONRenderOptions): string;

/** A user-supplied format checker. Receives the candidate value, returns true if valid. */
export type FormatChecker = (value: string) => boolean;

/** The seven primitive `type` values defined by JSON Schema. */
export type JSONSchemaTypeName =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

/**
 * A hand-written type for authoring JSON Schema (draft 2020-12) objects inline
 * in TypeScript. Known keywords are typed, so you get autocomplete and an error
 * when a value has the wrong shape (e.g. `type: 123` or `required: 'id'`).
 * Unknown keywords are permitted, so custom/vendor keywords do not error.
 *
 * Pair it with {@link defineSchema} for inline authoring without `as const`.
 */
export interface JSONSchema {
  $id?: string;
  $schema?: string;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  definitions?: Record<string, JSONSchema>;
  $comment?: string;

  type?: JSONSchemaTypeName | JSONSchemaTypeName[];
  enum?: ReadonlyArray<unknown>;
  const?: unknown;

  title?: string;
  description?: string;
  default?: unknown;
  examples?: ReadonlyArray<unknown>;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;

  // object
  properties?: Record<string, JSONSchema>;
  required?: ReadonlyArray<string>;
  additionalProperties?: boolean | JSONSchema;
  patternProperties?: Record<string, JSONSchema>;
  propertyNames?: JSONSchema;
  minProperties?: number;
  maxProperties?: number;
  dependentRequired?: Record<string, ReadonlyArray<string>>;
  dependentSchemas?: Record<string, JSONSchema>;

  // array
  items?: JSONSchema | ReadonlyArray<JSONSchema>;
  prefixItems?: ReadonlyArray<JSONSchema>;
  additionalItems?: boolean | JSONSchema;
  contains?: JSONSchema;
  minContains?: number;
  maxContains?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // string
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;

  // number
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // composition
  allOf?: ReadonlyArray<JSONSchema>;
  anyOf?: ReadonlyArray<JSONSchema>;
  oneOf?: ReadonlyArray<JSONSchema>;
  not?: JSONSchema;
  if?: JSONSchema;
  then?: JSONSchema;
  else?: JSONSchema;

  /** OpenAPI compatibility: ata honors `nullable` as a JSON Schema extension. */
  nullable?: boolean;

  /** Custom and vendor keywords are allowed without error. */
  [keyword: string]: unknown;
}

/**
 * Collapse an intersection of mapped object types into a single readable object
 * type. `& {}` forces TypeScript to evaluate the mapped type eagerly.
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Keys listed in a schema's `required` array, as a string union (or never). */
type RequiredKeys<S> = S extends { required: infer R }
  ? R extends ReadonlyArray<infer K extends string>
    ? K
    : never
  : never;

/** Object shape: required keys are required, all other declared keys optional. */
type InferObject<S> = S extends { properties: infer P }
  ? Simplify<
      { [K in keyof P as K extends RequiredKeys<S> ? K : never]: Infer<P[K]> } &
      { [K in keyof P as K extends RequiredKeys<S> ? never : K]?: Infer<P[K]> }
    >
  : Record<string, unknown>;

/** Array shape: `items` as a single schema maps to an element type; tuple/absent -> unknown[]. */
type InferArray<S> = S extends { items: infer I }
  ? I extends ReadonlyArray<unknown>
    ? unknown[]
    : Infer<I>[]
  : unknown[];

/** Map a single JSON Schema type name (+ its schema) to a TS type. */
type InferByTypeName<N, S> = N extends 'object'
  ? InferObject<S>
  : N extends 'array'
    ? InferArray<S>
    : N extends 'string'
      ? string
      : N extends 'number'
        ? number
        : N extends 'integer'
          ? number
          : N extends 'boolean'
            ? boolean
            : N extends 'null'
              ? null
              : unknown;

/**
 * Infer the TypeScript data type a JSON Schema literal describes (Core scope).
 *
 * Handles: primitives, `type` arrays (union), `const`, `enum`, objects
 * (`properties` + `required` -> required/optional keys), and arrays
 * (`items` as a single schema). `$ref`/`$defs`, tuples, and `anyOf`/`oneOf`/
 * `allOf` are not yet inferred and resolve to `unknown` rather than erroring.
 *
 * Pair with {@link defineSchema}:
 * `const s = defineSchema({...}); type T = Infer<typeof s>;`
 */
export type Infer<S> = S extends { const: infer C }
  ? C
  : S extends { enum: infer E }
    ? E extends ReadonlyArray<infer U>
      ? U
      : unknown
    : S extends { type: infer T }
      ? T extends ReadonlyArray<infer N>
        ? InferByTypeName<N, S>
        : InferByTypeName<T, S>
      : unknown;

export type ValidationResult<T = unknown> =
  | { valid: true;  data: T;       errors: ValidationError[] }
  | { valid: false; data?: never;  errors: ValidationError[] };

export type ValidateAndParseResult<T = unknown> =
  | { valid: true;  value: T;       errors: ValidationError[] }
  | { valid: false; value: unknown; errors: ValidationError[] };

export interface ValidatorOptions {
  coerceTypes?: boolean;
  removeAdditional?: boolean;
  schemas?: Record<string, object> | object[];
  /**
   * Custom format checkers. Keys are format names referenced from `format` in
   * the schema. Values are functions that return true when the input is valid.
   */
  formats?: Record<string, FormatChecker>;
  /**
   * When true, validation errors include `parentSchema` (the schema object
   * that produced the error). Matches ajv's `verbose: true`.
   */
  verbose?: boolean;
  /**
   * When true, validate() returns a shared frozen result on the first failure
   * instead of collecting full error details. Smaller hot-path allocation.
   */
  abortEarly?: boolean;
  /**
   * Optional source descriptor for the schema. When supplied, validation errors
   * carry a `schemaSource` frame pointing to the originating file/line/col.
   */
  source?: { path: string; content: string };
  /**
   * When true (default), validate() returns enriched errors with stable codes,
   * docUrl, expected/received hints. Set to false to opt back into the
   * v0.14 error shape.
   */
  richErrors?: boolean;
}

export interface BundleStandaloneOptions extends ValidatorOptions {
  /** Module format for the emitted bundle. Default: 'cjs'. */
  format?: 'esm' | 'cjs';
}

export interface StandardSchemaV1Props {
  version: 1;
  vendor: "ata-validator";
  validate(
    value: unknown
  ):
    | { value: unknown }
    | {
        issues: Array<{
          message: string;
          /** Array indices are emitted as numbers, object keys as strings. */
          path?: ReadonlyArray<{ key: PropertyKey }>;
        }>;
      };
}

export interface StandaloneModule {
  boolFn: (data: unknown) => boolean;
  hybridFactory: (validResult: object, errFn: Function) => (data: unknown) => ValidationResult;
  errFn: ((data: unknown, allErrors?: boolean) => ValidationResult) | null;
}

/** Instance surface of a compiled validator. */
export interface Validator<T = unknown> {
  /** Add a schema to the registry for cross-schema $ref resolution */
  addSchema(schema: object): void;

  /** Validate data, returns result with errors. Applies defaults, coerceTypes, removeAdditional. */
  validate(data: unknown): ValidationResult<T>;

  /** Fast boolean check via JS codegen or tier 0 interpreter. No error collection. */
  isValidObject(data: unknown): data is T;

  /** Validate a JSON string. Uses simdjson fast path for large documents. */
  validateJSON(jsonString: string): ValidationResult<T>;

  /** Fast boolean check for a JSON string */
  isValidJSON(jsonString: string): boolean;

  /** Parse JSON with simdjson + validate against schema. Returns parsed value and validation result. Requires native addon. */
  validateAndParse(jsonString: string | Buffer): ValidateAndParseResult<T>;

  /** Ultra-fast buffer validation via native addon */
  isValid(input: Buffer | Uint8Array | string): boolean;

  /** Count valid documents in an NDJSON buffer. Requires native addon. */
  countValid(ndjsonBuf: Buffer | Uint8Array | string): number;

  /** Validate an array of buffers, returns count of valid ones. Requires native addon. */
  batchIsValid(buffers: (Buffer | Uint8Array)[]): number;

  /** Zero-copy validation with pre-padded buffer. Requires native addon. */
  isValidPrepadded(paddedBuffer: Buffer, jsonLength: number): boolean;

  /** Multi-core parallel NDJSON validation. Returns boolean per line. Requires native addon. */
  isValidParallel(ndjsonBuffer: Buffer): boolean[];

  /** Single-thread NDJSON batch validation. Requires native addon. */
  isValidNDJSON(ndjsonBuffer: Buffer): boolean[];

  /** Generate a standalone JS module string for zero-compile loading. Returns null if schema can't be standalone-compiled. */
  toStandalone(): string | null;

  /**
   * Generate a self-contained module string with `validate`/`isValid` exports.
   * The output has zero runtime dependency on ata-validator.
   */
  toStandaloneModule(options?: { format?: 'esm' | 'cjs'; abortEarly?: boolean }): string | null;

  /** Standard Schema V1 interface, compatible with Fastify, tRPC, TanStack, etc. */
  readonly "~standard": StandardSchemaV1Props;
}

/** Constructor + statics for {@link Validator}. */
export interface ValidatorConstructor {
  /** Construct from a JSON Schema literal; the validated data type is inferred. */
  new <const S extends JSONSchema>(schema: S, options?: ValidatorOptions): Validator<Infer<S>>;
  /** Construct from a plain object/string schema, or with an explicit data type. */
  new <T = unknown>(schema: object | string, options?: ValidatorOptions): Validator<T>;

  /** Load a pre-compiled standalone module. Zero schema compilation at startup. */
  fromStandalone<T = unknown>(mod: StandaloneModule, schema: object | string, options?: ValidatorOptions): Validator<T>;

  /** Bundle multiple schemas into a single JS module string. Load with Validator.loadBundle(). */
  bundle(schemas: object[], options?: ValidatorOptions): string;

  /**
   * Bundle multiple schemas into a self-contained JS module with no
   * ata-validator runtime dependency. Cross-schema `$ref` resolves between
   * the supplied schemas. Set `format: 'esm'` for ESM output (default 'cjs').
   */
  bundleStandalone(schemas: object[], options?: BundleStandaloneOptions): string;

  /**
   * Bundle multiple schemas with deduplicated shared templates. Smaller output
   * than bundle(). Accepts the same options as bundleStandalone.
   */
  bundleCompact(schemas: object[], options?: BundleStandaloneOptions): string;

  /** Load a bundle created by Validator.bundle(). Returns array of Validator instances. */
  loadBundle(mods: object[], schemas: object[], options?: ValidatorOptions): Validator[];

  readonly prototype: Validator;
}

/** Compile a schema into a reusable validator. */
export const Validator: ValidatorConstructor;

/** One-shot validate: creates a Validator, validates data, returns result. */
export function validate<T = unknown>(
  schema: object | string,
  data: unknown
): ValidationResult<T>;

/** Fast compile: returns a validate function directly. WeakMap cached, second call with same schema is near-zero cost. */
export function compile<T = unknown>(
  schema: object | string,
  options?: ValidatorOptions
): (data: unknown) => ValidationResult<T>;

/** Parse JSON using simdjson (native addon) or JSON.parse (fallback). */
export function parseJSON(jsonString: string | Buffer): unknown;

/** Returns ata-validator version string. */
export function version(): string;

/** Create a simdjson-compatible padded buffer from a JSON string. */
export function createPaddedBuffer(jsonStr: string): { buffer: Buffer; length: number };

/** Required padding size for simdjson buffers. */
export const SIMDJSON_PADDING: number;

/**
 * Generate a TypeScript declaration (.d.ts source) for the given JSON Schema.
 * Returns a string containing the generated type plus `isValid` / `validate`
 * signatures. Used internally by the `ata compile` CLI and exposed for
 * build-time integrations (Vite plugin, custom build steps).
 */
export function toTypeScript(schema: object, options?: { name?: string }): string;

/**
 * Authoring helper for writing a JSON Schema inline in TypeScript. Returns the
 * schema unchanged at runtime; its purpose is to apply the {@link JSONSchema}
 * type so you get keyword autocomplete and an error on malformed values, while
 * the `const` type parameter preserves the literal shape (no `as const` needed).
 *
 * ```ts
 * import { defineSchema, Validator } from 'ata-validator';
 *
 * const user = defineSchema({
 *   type: 'object',
 *   properties: { id: { type: 'integer', minimum: 1 } },
 *   required: ['id'],
 * });
 *
 * const v = new Validator(user);
 * ```
 *
 * Requires TypeScript >= 5.0 for the `const` type parameter.
 */
export declare function defineSchema<const S extends JSONSchema>(schema: S): S;
