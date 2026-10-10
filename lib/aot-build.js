'use strict';
const { env } = require('./env');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Validator } = require('..');
const { buildPositionMap } = require('./source-positions');

function resolveSourceDefault (opts) {
  if (opts.source === true) return true;
  if (opts.source === false) return false;
  return env('NODE_ENV') !== 'production';
}

async function expandGlobs(globs) {
  const out = [];
  for (const raw of globs) {
    // Glob patterns use forward slashes; normalize Windows backslashes so the
    // matcher (Node 22+ fs.glob or the fallback regex) sees a consistent
    // separator. Node accepts forward slashes in paths on Windows.
    const g = raw.replace(/\\/g, '/');
    if (typeof fs.promises.glob === 'function') {
      // Node 22+
      for await (const f of fs.promises.glob(g)) out.push(path.resolve(f));
    } else {
      // Node 18-21 fallback: simple non-recursive directory + extension match
      // Pattern accepted: '<dir>/*.<ext>' or absolute file path.
      if (fs.existsSync(g) && fs.statSync(g).isFile()) {
        out.push(path.resolve(g));
        continue;
      }
      // Split on the first "/*." that has something after it, by index rather
      // than a regular expression, which backtracked polynomially on a long
      // run of "/*.a".
      const star = g.indexOf('/*.');
      const split = star !== -1 && star + 3 < g.length;
      const dir = (split ? g.slice(0, star) : g) || '.';
      const ext = split ? '.' + g.slice(star + 3) : null;
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (ext && !entry.endsWith(ext)) continue;
        const full = path.join(dir, entry);
        if (fs.statSync(full).isFile()) out.push(path.resolve(full));
      }
    }
  }
  return [...new Set(out)];
}

function parseSchemaFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return JSON.parse(text);
  if (ext === '.yaml' || ext === '.yml') {
    let yaml;
    try { yaml = require('yaml'); }
    catch { throw new Error(`install the 'yaml' package to compile YAML schemas (file: ${filePath})`); }
    return yaml.parse(text);
  }
  throw new Error(`unsupported schema extension: ${ext} (file: ${filePath})`);
}

function outputPathFor(input, opts) {
  const suffix = opts.suffix || '.compiled';
  const ext = opts.format === 'cjs' ? '.cjs' : '.mjs';
  const dir = opts.outDir || path.dirname(input);
  const base = path.basename(input, path.extname(input));
  // Strip a trailing ".schema" for cleaner output names: foo.schema.json -> foo.compiled.mjs
  const stem = base.endsWith('.schema') ? base.slice(0, -('.schema'.length)) : base;
  return path.join(dir, stem + suffix + ext);
}

function readCache(cacheFile) {
  if (!cacheFile || !fs.existsSync(cacheFile)) return {};
  try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return {}; }
}

function writeCache(cacheFile, data) {
  if (!cacheFile) return;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
}

function hashContent(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

// Where the shared error runtime goes: the output directory when there is
// one, otherwise the deepest directory that holds every output.
function runtimePathFor(outputs, opts, format) {
  const name = 'ata-errors' + (format === 'cjs' ? '.cjs' : '.mjs');
  if (opts.outDir) return path.join(opts.outDir, name);
  let dir = path.resolve(path.dirname(outputs[0]));
  for (const o of outputs) {
    const d = path.resolve(path.dirname(o));
    while (dir !== d && !d.startsWith(dir + path.sep)) dir = path.dirname(dir);
  }
  return path.join(dir, name);
}

function importSpecifier(fromFile, toFile) {
  let rel = path.relative(path.dirname(path.resolve(fromFile)), path.resolve(toFile)).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

const RUNTIME_PLACEHOLDER = '__ATA_ERROR_RUNTIME__';
const ERRORS_MODES = new Set(['auto', 'inline', 'shared']);

async function build(opts) {
  const globs = opts.globs || [];
  if (globs.length === 0) throw new Error('build: at least one glob required');
  const format = opts.format || 'esm';
  const errorsMode = opts.errors || 'auto';
  if (!ERRORS_MODES.has(errorsMode)) throw new Error(`build: errors must be auto, inline or shared (got "${errorsMode}")`);
  const inputs = await expandGlobs(globs);
  const cache = readCache(opts.cacheFile);
  const newCache = {};
  const source = resolveSourceDefault(opts);
  // Error detail from the shared runtime replaces generated error code, so it
  // is only on offer where that code is what the build would emit: not with
  // schema-source frames (development builds), stub errors or the one-pass
  // function, which are each asked for by name.
  const sharable = errorsMode !== 'inline' && !source && !opts.abortEarly && opts.onePass !== true;

  const compiled = [];
  const cached = [];
  const skipped = [];
  const failed = [];
  const warnings = [];
  const entries = [];

  const compileOne = (input, raw) => {
    const schema = parseSchemaFile(input);
    // The build is where an authoring mistake is cheapest to stop: a typo
    // like maxLenght compiles into a validator that simply lacks the rule,
    // and a compiled module fails even more quietly than a runtime one,
    // since nobody ever revisits it. Findings fail the input's build.
    if (opts.strictSchema) {
      const { checkSchemaStrict } = require('./strict-check');
      const problems = checkSchemaStrict(schema, {});
      if (problems.length > 0) {
        return { error: problems.map((x) => `strict mode: ${x.message} at ${x.path}`).join('; ') };
      }
    }
    const v = new Validator(schema);
    let sourceMap = null;
    if (source) {
      // Only attempt position map for JSON (the scanner is JSON-only).
      const ext = path.extname(input).toLowerCase();
      if (ext === '.json') {
        try { sourceMap = buildPositionMap(raw.toString('utf8')); }
        catch { sourceMap = null; }
      }
    }
    const schemaFile = path.relative(process.cwd(), input) || input;
    const inputWarnings = [];
    const src = aot.toStandaloneModule(v, {
      format,
      abortEarly: !!opts.abortEarly,
      onePass: opts.onePass === true ? true : undefined,
      source,
      sourceMap,
      schemaFile,
      formatMode: opts.formatMode,
      onWarning: (w, meta) => inputWarnings.push({ message: w, kind: (meta && meta.kind) || 'general' }),
    });
    const compact = sharable && src ? aot.toCompactModule(v, { format, formatMode: opts.formatMode, errorRuntime: RUNTIME_PLACEHOLDER }) : null;
    // The runtime parts this module's schema needs (see runtimeFeatures).
    const features = compact ? require('./error-runtime').runtimeFeatures([require('./schema-strip').stripAnnotations(v._schemaObj)]) : null;
    // A module that imports the pattern engine needs it in the runtime,
    // whatever the schema scan said.
    if (features && compact.includes('_ataCompileSafe')) features['safe-regex'] = true;
    return { schema, src, compact, features, inputWarnings };
  };

  for (const input of inputs) {
    try {
      const raw = fs.readFileSync(input);
      const inputHash = hashContent(raw);
      const output = outputPathFor(input, { ...opts, format });
      const cacheEntry = cache[input];
      const fresh = !!(
        cacheEntry &&
        cacheEntry.inputHash === inputHash &&
        cacheEntry.output === output &&
        !!cacheEntry.sharable === sharable &&
        fs.existsSync(output) &&
        cacheEntry.outputHash === hashContent(fs.readFileSync(output))
      );
      if (opts.check) {
        if (fresh) cached.push({ input, output });
        continue;
      }
      if (fresh) {
        entries.push({ input, output, raw, inputHash, cacheEntry, fullGz: cacheEntry.fullGz, compactGz: cacheEntry.compactGz, features: cacheEntry.features || null });
        continue;
      }
      const r = compileOne(input, raw);
      if (r.error) { failed.push({ input, error: r.error }); continue; }
      if (r.inputWarnings.length > 0) {
        if (opts.strict) {
          failed.push({ input, error: r.inputWarnings.map((x) => x.message).join('; ') });
          continue;
        }
        // `kind` says which capability degraded ('error-detail', 'parse'),
        // so a caller that requested both can tell the warnings apart.
        for (const x of r.inputWarnings) warnings.push({ input, warning: x.message, kind: x.kind });
      }
      if (!r.src) {
        const reason = 'schema is not AOT-compatible (toStandaloneModule returned null)';
        if (opts.strict) failed.push({ input, error: reason });
        else skipped.push({ input, reason });
        continue;
      }
      entries.push({
        input, output, raw, inputHash, schema: r.schema, src: r.src, compact: r.compact, features: r.features,
        fullGz: zlib.gzipSync(r.src).length,
        compactGz: r.compact ? zlib.gzipSync(r.compact).length : null,
      });
    } catch (e) {
      failed.push({ input, error: e.message });
    }
  }

  if (opts.check) {
    const staleCount = inputs.length - cached.length;
    return { compiled: [], cached, skipped, failed, warnings, staleCount };
  }

  // A module takes its errors from the shared runtime when that makes it
  // smaller, and the runtime is written when the modules that use it save
  // more than it weighs. With `errors: 'shared'` every module that can, does.
  // The runtime carries only the parts the compact modules' schemas need
  // (formats, the pattern engine, deep equality); an entry with no record of
  // its needs (a cache written before this) counts as needing everything.
  const { errorRuntimeSource, runtimeFeatures } = require('./error-runtime');
  const ATA_VERSION = require('./version');
  const unionOf = (list) => {
    const out = runtimeFeatures([]);
    for (const e of list) for (const k of Object.keys(out)) if (!e.features || e.features[k]) out[k] = true;
    return out;
  };
  const candidates = entries.filter((e) => typeof e.compactGz === 'number' && (errorsMode === 'shared' || e.compactGz < e.fullGz));
  let runtime = null;
  if (sharable && candidates.length > 0) {
    const runtimeSrc = errorRuntimeSource(format, ATA_VERSION, unionOf(candidates));
    const runtimeGz = zlib.gzipSync(runtimeSrc).length;
    let saving = 0;
    for (const e of candidates) saving += e.fullGz - e.compactGz;
    const use = errorsMode === 'shared' || saving > runtimeGz;
    if (use) runtime = { path: runtimePathFor(entries.map((e) => e.output), opts, format), src: runtimeSrc, gz: runtimeGz };
  }
  for (const e of entries) {
    e.mode = runtime !== null && candidates.includes(e) ? 'compact' : 'inline';
  }

  for (const e of entries) {
    const { input, output } = e;
    try {
      if (e.cacheEntry) {
        const sameRuntime = e.mode === 'inline' || (runtime !== null && e.cacheEntry.runtime === runtime.path);
        if (e.cacheEntry.mode === e.mode && sameRuntime) {
          cached.push({ input, output });
          newCache[input] = e.cacheEntry;
          continue;
        }
        // The build's choice for this module changed: compile it again.
        const r = compileOne(input, e.raw);
        if (r.error || !r.src) { failed.push({ input, error: r.error || 'schema is not AOT-compatible' }); continue; }
        e.schema = r.schema; e.src = r.src; e.compact = r.compact; e.features = r.features;
        if (e.mode === 'compact' && !r.compact) e.mode = 'inline';
      }
      const src = e.mode === 'compact'
        ? e.compact.split(JSON.stringify(RUNTIME_PLACEHOLDER)).join(JSON.stringify(importSpecifier(output, runtime.path)))
        : e.src;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, src);
      const outBytes = Buffer.byteLength(src, 'utf8');
      const gzBytes = zlib.gzipSync(src).length;
      if (typeof opts.maxSize === 'number' && gzBytes > opts.maxSize) {
        // Roll back the write so a failed build doesn't leave a stale artifact.
        try { fs.unlinkSync(output); } catch {}
        failed.push({ input, error: `output ${output} exceeds --max-size: ${gzBytes} > ${opts.maxSize} (gzipped bytes)` });
        continue;
      }
      compiled.push({ input, output, bytes: outBytes, gzipBytes: gzBytes, errors: e.mode });
      if (opts.types !== false) {
        const { toTypeScript } = require('./ts-gen');
        const stem = path.basename(input, path.extname(input)).replace(/\.schema$/, '');
        const typeName = stem
          .replace(/[^A-Za-z0-9_]/g, '_')
          .replace(/^([a-z])/, (m) => m.toUpperCase()) || 'Data';
        const dts = toTypeScript(e.schema, { name: typeName });
        const ext = path.extname(output);
        const dtsExt = ext === '.mjs' ? '.d.mts'
          : ext === '.cjs' ? '.d.cts'
          : '.d.ts';
        const base = output.slice(0, output.length - ext.length);
        fs.writeFileSync(base + dtsExt, dts);
      }
      newCache[input] = {
        inputHash: e.inputHash,
        output,
        outputHash: hashContent(Buffer.from(src, 'utf8')),
        sharable,
        mode: e.mode,
        runtime: e.mode === 'compact' ? runtime.path : undefined,
        fullGz: e.fullGz,
        compactGz: e.compactGz,
        features: e.features || undefined,
      };
    } catch (err) {
      failed.push({ input, error: err.message });
    }
  }

  let runtimeReport = null;
  if (runtime !== null && entries.some((e) => e.mode === 'compact')) {
    const current = fs.existsSync(runtime.path) ? fs.readFileSync(runtime.path, 'utf8') : null;
    if (current !== runtime.src) {
      fs.mkdirSync(path.dirname(runtime.path), { recursive: true });
      fs.writeFileSync(runtime.path, runtime.src);
    }
    runtimeReport = { output: runtime.path, bytes: Buffer.byteLength(runtime.src, 'utf8'), gzipBytes: runtime.gz };
  }

  writeCache(opts.cacheFile, newCache);

  return { compiled, cached, skipped, failed, warnings, runtime: runtimeReport };
}

async function watch(opts, onReport) {
  const initial = await build(opts);
  if (typeof onReport === 'function') onReport(initial);

  const inputs = await expandGlobs(opts.globs || []);
  const dirs = [...new Set(inputs.map((p) => path.dirname(p)))];
  let debounceTimer = null;

  const runOnce = async () => {
    debounceTimer = null;
    try {
      const r = await build(opts);
      if (typeof onReport === 'function') onReport(r);
    } catch (e) {
      if (typeof onReport === 'function') onReport({ compiled: [], cached: [], skipped: [], failed: [{ input: '<watch>', error: e.message }] });
    }
  };

  const watchers = dirs.map((d) => fs.watch(d, (_event, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runOnce, 100);
  }));

  return {
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) w.close();
    },
  };
}

// AOT primitives also surface here so consumers can do
//   import { bundleStandalone, toStandaloneModule, bundleCompact } from 'ata-validator/build'
// without poking at the Validator class. The class-bound statics (Validator.bundleStandalone,
// Validator.bundle, Validator.bundleCompact) remain available from the default entry; this
// build entry is the programmatic alias for code that wants the build surface in one place.
const aot = require('./aot');

function bundleStandalone(schemas, opts) {
  return aot.bundleStandalone(Validator, schemas, opts);
}

function bundleCompact(schemas, opts) {
  return aot.bundleCompact(Validator, schemas, opts);
}

function toStandaloneModule(schema, opts) {
  // The same authoring-time checks `ata compile --strict-schema` runs, for
  // callers driving the build API directly: a typo in a schema headed for a
  // compiled module is the quietest place a typo can live.
  if (opts && opts.strictSchema) {
    const { checkSchemaStrict } = require('./strict-check');
    const problems = checkSchemaStrict(schema, {});
    if (problems.length > 0) {
      throw new Error(problems.map((x) => `strict mode: ${x.message} at ${x.path}`).join('\n'));
    }
  }
  const v = schema instanceof Validator ? schema : new Validator(schema, opts);
  return aot.toStandaloneModule(v, opts);
}

const { schemaHash } = require('./schema-hash');

// Whether `new Validator(schema)` with default options can be replaced by
// fromCompiled() around the module toStandaloneModule(schema) writes, which a
// bundler plugin does so the runtime compiler stays out of the bundle. The
// wrapper reproduces a default Validator's results exactly for these schemas;
// tests/test_compiled_parity.js holds that. Declined: custom error messages,
// which the core applies in a layer the wrapper does not carry. A caller must also get a
// module back from toStandaloneModule, which returns null for a schema it
// cannot compile. The text check is deliberately coarse: a property named
// `errorMessage` declines too, and declining costs only the saving.
function compiledEligible(schema) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return false;
  return !JSON.stringify(schema).includes('"errorMessage"');
}

// The schema a default Validator reads, after normalization: what
// fromCompiled() takes, so its defaults, sorting and diagnostics follow the
// same document the runtime does.
function compiledSchemaFor(schema) {
  const { Validator } = require('../index.js');
  return new Validator(schema)._schemaObj;
}

// The module that replaces `new Validator(schema)`, or null where the
// replacement would not answer as the runtime does: a schema
// compiledEligible() declines, one the emitter cannot compile, and one whose
// error function the generator declines (unevaluated* among them), where the
// module would report every failure as the ATA9000 stub while the runtime
// reports the real errors.
//
// With `errorRuntime` (an import specifier, usually 'ata-validator/error-runtime'),
// the module is written compact where the validator allows it: the verdict and
// the schema, with errors from that runtime (see toCompactModule). A plugin
// writes it in place of the self-contained module when that is smaller for
// the whole bundle; the runtime is shared by every compact module in it.
function compiledModuleFor(schema, opts) {
  if (!compiledEligible(schema)) return null;
  if (opts && typeof opts.errorRuntime === 'string') {
    try {
      const v = new Validator(schema);
      const src = aot.toCompactModule(v, { format: opts.format || 'esm', errorRuntime: opts.errorRuntime });
      if (src) return src;
    } catch {
      return null;
    }
    // Not writable as a compact module: the self-contained one below.
  }
  let degraded = false;
  let src;
  try {
    src = toStandaloneModule(schema, {
      format: (opts && opts.format) || 'esm',
      onWarning: (msg, info) => { if (info && info.kind === 'error-detail') degraded = true; },
    });
  } catch {
    return null;
  }
  return src && !degraded ? src : null;
}

// The Validator options fromCompiled() reproduces, for a plugin deciding whether
// `new Validator(schema, options)` can be replaced. An older ata-validator does
// not export this, and a plugin should then replace only calls without options.
const { COMPILED_OPTIONS: compiledOptions } = require('./compiled');

module.exports = {
  compiledOptions,
  compiledEligible,
  compiledSchemaFor,
  compiledModuleFor,
  build,
  expandGlobs,
  parseSchemaFile,
  outputPathFor,
  watch,
  bundleStandalone,
  bundleCompact,
  toStandaloneModule,
  schemaHash,
};
