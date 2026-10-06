export interface BuildOptions {
  /** Glob patterns to expand into input schema files. */
  globs: string[];
  /** Module format for compiled outputs. Default: 'esm'. */
  format?: 'esm' | 'cjs';
  /** Write outputs into this directory instead of alongside sources. */
  outDir?: string;
  /** Output filename suffix. Default: '.compiled'. */
  suffix?: string;
  /** Use stub error functions for the smallest output. Default: false. */
  abortEarly?: boolean;
  /** Path to incremental cache file. Default: cache disabled. */
  cacheFile?: string;
  /** When true, do not write outputs; only report stale count. */
  check?: boolean;
  /** Maximum gzipped output size per compiled module, in bytes. */
  maxSize?: number;
  /** When true, AOT-incompatible schemas become failures (default: skipped). */
  strict?: boolean;
  /** Emit a .d.mts/.d.cts/.d.ts sibling for each compiled module. Default: true. */
  types?: boolean;
  /**
   * Embed a schema source map and bake per-error `schemaSource` frames.
   * Defaults to true when `NODE_ENV !== 'production'`, false otherwise.
   * Set explicitly to override the environment default.
   */
  source?: boolean;
}

export interface CompiledEntry {
  input: string;
  output: string;
  bytes: number;
  gzipBytes?: number;
}

export interface CachedEntry {
  input: string;
  output: string;
}

export interface SkippedEntry {
  input: string;
  reason: string;
}

export interface FailedEntry {
  input: string;
  error: string;
}

export interface BuildReport {
  compiled: CompiledEntry[];
  cached: CachedEntry[];
  skipped: SkippedEntry[];
  failed: FailedEntry[];
  /** Only set when opts.check === true. */
  staleCount?: number;
}

export function build(opts: BuildOptions): Promise<BuildReport>;
export function expandGlobs(globs: string[]): Promise<string[]>;
export function parseSchemaFile(filePath: string): unknown;
export function outputPathFor(input: string, opts: { format?: 'esm' | 'cjs'; outDir?: string; suffix?: string }): string;

export interface WatchHandle {
  close(): void;
}
export function watch(opts: BuildOptions, onReport?: (r: BuildReport) => void): Promise<WatchHandle>;

// --- AOT primitives ---
// Programmatic counterparts to `Validator.bundleStandalone` / `bundleCompact`.
// Kept here so callers that only want the build surface (e.g. a bundler
// plugin) don't have to import the full runtime.

export interface BundleStandaloneOptions {
  format?: 'cjs' | 'esm';
  formats?: Record<string, (value: string) => boolean>;
  /**
   * How custom format functions reach the output. 'embed' (default) writes
   * each function's source into the module; it must be a plain function
   * with no closed-over variables and no coverage instrumentation, or the
   * build throws. 'inject' writes no function source: the module exports
   * `setFormats(map)` and looks formats up from that registry at validation
   * time, so the caller supplies them at load time.
   */
  formatMode?: 'embed' | 'inject';
  verbose?: boolean;
}

export interface ToStandaloneModuleOptions {
  /**
   * Run the authoring-time schema checks before emitting: unknown keywords
   * (with a spelling suggestion), inert keywords, unsatisfiable required
   * names, unresolvable local $refs. Throws with every finding.
   */
  strictSchema?: boolean;
  /**
   * Called when the module ships degraded: error detail was requested but
   * neither error path takes this schema, so failures report the single
   * ATA9000 abort-early error while the verdict stays exact.
   */
  onWarning?: (message: string) => void;
  format?: 'cjs' | 'esm';
  abortEarly?: boolean;
  /**
   * Report errors with the runtime's one-pass function, the program
   * `validate()` runs once a validator's errors have been read: one walk that
   * checks and collects, with a verdict per subtree. On a 175 KB schema and a
   * 15 KB document it rejects in 39 µs where the older collector took 89. Its
   * module is 1.3 to 1.7 times the older one, gzipped, so it is not the
   * default; `true` asks for it, `false` refuses it. Without the option the
   * one-pass function is taken only where the older collector declines the
   * schema, which reported one stub error before. A module built with
   * `source` frames, or from a validator with a custom format, keeps the
   * older collector either way.
   */
  onePass?: boolean;
  source?: boolean;
  sourceMap?: unknown;
  schemaFile?: string;
  formats?: Record<string, (value: string) => boolean>;
  /** See {@link BundleStandaloneOptions.formatMode}. */
  formatMode?: 'embed' | 'inject';
  /**
   * Also export `parse(data)`: validate, then return a copy of the input
   * holding only the properties the schema declares, with declared `default`
   * values filled in for absent optional properties (object and array
   * defaults are fresh per call). Off by default because it adds to the
   * emitted module's size. Emitted only where the copy is provably exact:
   * `$ref` and `patternProperties` decline; in-place applicators (`allOf`,
   * `anyOf`, `oneOf`, `if`/`then`/`else`, and `unevaluatedProperties: false`)
   * are admitted when every property name they mention is already declared
   * in the node's own `properties`. A required property with a default, or
   * a default its own schema rejects, also declines, because those are the
   * two shapes where parse() and the runtime would disagree.
   */
  parse?: boolean;
  /**
   * Also export `validateJSON(text)`: parse the JSON text, validate, and on
   * failure attach a `dataFrame` ({ byteOffset, length, line, col, text })
   * to every error by walking the original text once, so errors point at the
   * right occurrence even when the same key appears in several sections.
   * Off by default because the embedded position walker adds to the emitted
   * module's size.
   */
  positions?: boolean;
}

/** Bundle multiple schemas into one self-contained module (no ata-validator runtime). */
export function bundleStandalone(schemas: unknown[], options?: BundleStandaloneOptions): string;

/** Like {@link bundleStandalone} but deduplicates shared bodies for smaller output. */
export function bundleCompact(schemas: unknown[], options?: BundleStandaloneOptions): string;

/**
 * Stable content hash of a schema, 16 hex characters, over a canonical JSON
 * form (keys sorted at every level). Every module from
 * {@link toStandaloneModule} exports its own `schemaHash`; comparing that
 * against `schemaHash(currentSchema)` tells a build the schema has changed.
 * It does not tell the build that ata has changed, since an upgrade leaves
 * the hash matching, so compare the module's `ataVersion` against the
 * installed version as well. An integrity aid, not a security boundary.
 */
export function schemaHash(schema: unknown): string;

/** Emit a self-contained `validate`/`isValid` module string for a single
 * schema, plus `parse` when {@link ToStandaloneModuleOptions.parse} is set
 * and `validateJSON` when {@link ToStandaloneModuleOptions.positions} is. */
export function toStandaloneModule(schema: unknown, options?: ToStandaloneModuleOptions): string | null;

/**
 * Whether `new Validator(schema)` with default options can be replaced by
 * `fromCompiled()` from `ata-validator/compiled`. False for a schema with
 * custom `errorMessage`s. A caller also needs {@link compiledModuleFor} to
 * return a module.
 */
export function compiledEligible(schema: unknown): boolean;

/**
 * The schema a default `Validator` reads after normalization. Pass it to
 * `fromCompiled()`, so defaults, error order and diagnostics follow the same
 * document the runtime does.
 */
export function compiledSchemaFor(schema: unknown): object;

/**
 * The module that replaces `new Validator(schema)`, or null where the
 * replacement would not answer as the runtime does: a schema
 * {@link compiledEligible} declines, one the emitter cannot compile, and one
 * whose detailed errors the generator cannot produce.
 */
export function compiledModuleFor(schema: unknown, opts?: { format?: 'esm' | 'cjs' }): string | null;

/**
 * The Validator options `fromCompiled()` reproduces, so a plugin can tell
 * whether `new Validator(schema, options)` can be replaced. Absent before
 * ata-validator 1.37.0, where only calls without options can be.
 */
export const compiledOptions: readonly string[];
