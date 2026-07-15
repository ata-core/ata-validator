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
  verbose?: boolean;
}

export interface ToStandaloneModuleOptions {
  format?: 'cjs' | 'esm';
  abortEarly?: boolean;
  source?: boolean;
  sourceMap?: unknown;
  schemaFile?: string;
}

/** Bundle multiple schemas into one self-contained module (no ata-validator runtime). */
export function bundleStandalone(schemas: unknown[], options?: BundleStandaloneOptions): string;

/** Like {@link bundleStandalone} but deduplicates shared bodies for smaller output. */
export function bundleCompact(schemas: unknown[], options?: BundleStandaloneOptions): string;

/** Emit a self-contained `validate`/`isValid` module string for a single schema. */
export function toStandaloneModule(schema: unknown, options?: ToStandaloneModuleOptions): string | null;
