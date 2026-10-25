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

// The registry without the definitions no module reaches. A shared
// definitions file (Kubernetes ships one with hundreds) is mostly what a
// given set of schemas never uses. Only `definitions` and `$defs` entries are
// dropped, and only from a document every reference into which is a plain
// pointer into them; a document reached as a whole, through an anchor, or
// holding an embedded $id is kept as it is. The result is checked: every
// root's references must still resolve against it, or the whole registry is
// kept.
function pruneRegistry(roots, byId) {
  const used = new Map();
  const keepWhole = new Set();
  const seen = new Set();
  const queue = [];
  const hasInnerId = new Map();
  const innerId = (doc) => {
    let hit = hasInnerId.get(doc);
    if (hit !== undefined) return hit;
    hit = false;
    const stack = [doc];
    const visited = new Set();
    while (stack.length && !hit) {
      const n = stack.pop();
      if (n === null || typeof n !== 'object' || visited.has(n)) continue;
      visited.add(n);
      if (n !== doc && !Array.isArray(n) && typeof n.$id === 'string') hit = true;
      for (const k of Object.keys(n)) stack.push(n[k]);
    }
    hasInnerId.set(doc, hit);
    return hit;
  };
  const docOf = new Map();
  for (const [id, doc] of byId) docOf.set(id.replace(/#$/, ''), doc);
  const reach = (doc, base, node) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    queue.push([doc, base, node]);
  };
  const defsOf = (doc) => (doc.$defs && typeof doc.$defs === 'object' ? '$defs' : doc.definitions && typeof doc.definitions === 'object' ? 'definitions' : null);
  for (const root of roots) reach(root, typeof root.$id === 'string' ? root.$id : null, root);
  while (queue.length) {
    const [doc, base, node] = queue.pop();
    if (Array.isArray(node)) { for (const x of node) reach(doc, base, x); continue; }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if ((k === '$ref' || k === '$dynamicRef' || k === '$recursiveRef') && typeof v === 'string') {
        let abs;
        try { abs = base ? new URL(v, base).href : v.charCodeAt(0) === 35 ? null : new URL(v).href; } catch { abs = null; }
        const local = v.charCodeAt(0) === 35;
        const hash = abs === null ? -1 : abs.indexOf('#');
        const uri = abs === null ? null : hash < 0 ? abs : abs.slice(0, hash);
        const target = local ? doc : uri !== null ? docOf.get(uri) : undefined;
        if (target === undefined) continue;
        const frag = local ? v.slice(1) : hash < 0 ? '' : abs.slice(hash + 1);
        const tbase = local ? base : uri;
        const m = /^\/(\$defs|definitions)\/([^/]+)/.exec(frag);
        const which = defsOf(target);
        if (k !== '$ref' || m === null || m[1] !== which) {
          keepWhole.add(target);
          reach(target, tbase, target);
          continue;
        }
        let name = m[2];
        try { name = decodeURIComponent(name); } catch {}
        name = name.replace(/~1/g, '/').replace(/~0/g, '~');
        let set = used.get(target);
        if (set === undefined) { set = new Set(); used.set(target, set); }
        set.add(name);
        // The rest of the document around its definitions is used too.
        for (const key of Object.keys(target)) if (key !== which) reach(target, tbase, target[key]);
        reach(target, tbase, target[which][name]);
      } else if (v !== null && typeof v === 'object') {
        reach(doc, base, v);
      }
    }
  }
  const out = new Map();
  for (const [id, doc] of byId) {
    const which = defsOf(doc);
    if (which === null || keepWhole.has(doc) || innerId(doc) || roots.includes(doc)) { out.set(id, doc); continue; }
    const names = used.get(doc) || new Set();
    const defs = {};
    for (const name of Object.keys(doc[which])) if (names.has(name)) Object.defineProperty(defs, name, { value: doc[which][name], enumerable: true, writable: true, configurable: true });
    out.set(id, { ...doc, [which]: defs });
  }
  for (const root of roots) {
    if (!aot._refsResolveWithin(root, out)) return byId;
  }
  // The registry documents' own references too, as the runtime may walk any
  // part of a definition it keeps.
  for (const doc of out.values()) if (!aot._refsResolveWithin(doc, out)) return byId;
  return out;
}

function bunTargetPath (output) {
  const ext = path.extname(output);
  return output.slice(0, output.length - ext.length) + '.bun.ts';
}

async function build(opts) {
  // `--target bun`: every module written for JavaScriptCore, the plain ones
  // included, since the executable the target is for runs on it.
  const { setTargetEngine } = require('./js-compiler');
  const prevEngine = setTargetEngine(opts.target === 'bun' ? 'jsc-aot' : null);
  try {
    return await buildWith(opts);
  } finally {
    setTargetEngine(prevEngine);
  }
}

async function buildWith(opts) {
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
  // `mode: 'schema'`, asked for by name: every module that can be is a schema
  // module (its schema and a few lines), with the verdict and the errors from
  // one runtime. Smaller and quicker to load than generated code, slower per
  // check once warm.
  if (opts.mode !== undefined && opts.mode !== 'code' && opts.mode !== 'schema') throw new Error(`build: mode must be code or schema (got "${opts.mode}")`);
  const schemaMode = opts.mode === 'schema' && !opts.abortEarly;

  const compiled = [];
  const cached = [];
  // --target bun: the .bun.ts written beside a module, and the schemas whose
  // rules a type cannot carry.
  const bunTargets = [];
  const bunDeclined = [];
  const skipped = [];
  const failed = [];
  const warnings = [];
  const entries = [];

  // Schemas that reference each other: a schema whose references do not all
  // land inside it gets the other inputs registered beside it, each under its
  // $id, or, with `baseUri`, an input without one under the base URI and its
  // file name. In schema mode its module then resolves against one registry
  // module the build writes (registrySource); otherwise it is a
  // self-contained module carrying what it references. A schema that
  // resolves within itself is built exactly as it would be alone.
  if (opts.baseUri !== undefined) {
    try { new URL(opts.baseUri); } catch { throw new Error(`build: baseUri must be an absolute URI (got "${opts.baseUri}")`); }
  }
  let siblings = [];
  for (const input of inputs) {
    try {
      const sch = parseSchemaFile(input);
      if (sch === null || typeof sch !== 'object' || Array.isArray(sch)) continue;
      if (typeof sch.$id === 'string' && sch.$id !== '') siblings.push({ input, schema: sch });
      else if (opts.baseUri !== undefined) siblings.push({ input, schema: { $id: new URL(path.basename(input), opts.baseUri).href, ...sch } });
    } catch {}
  }
  if (siblings.length === 0) siblings = null;
  const REGISTRY_PLACEHOLDER = '__ATA_SCHEMA_REGISTRY__';

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
    const needs = siblings !== null && schema !== null && typeof schema === 'object' && !Array.isArray(schema) && !aot._refsResolveWithin(schema);
    const self = needs ? siblings.find((x) => x.input === input) : undefined;
    const others = needs ? siblings.filter((x) => x.input !== input && (self === undefined || x.schema.$id !== self.schema.$id)).map((x) => x.schema) : null;
    // Known under the base URI too, so its own relative references resolve
    // against it.
    const own = self !== undefined ? self.schema : schema;
    const v = others !== null && others.length > 0 ? new Validator(own, { schemas: others }) : new Validator(schema);
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
      order: opts.order === true ? true : undefined,
      source,
      sourceMap,
      schemaFile,
      formatMode: opts.formatMode,
      onWarning: (w, meta) => inputWarnings.push({ message: w, kind: (meta && meta.kind) || 'general' }),
    });
    const compact = schemaMode && src
      ? aot.toSchemaModule(v, others !== null && others.length > 0 ? { format, runtime: RUNTIME_PLACEHOLDER, registry: REGISTRY_PLACEHOLDER } : { format, runtime: RUNTIME_PLACEHOLDER })
      : sharable && src ? aot.toCompactModule(v, { format, formatMode: opts.formatMode, errorRuntime: RUNTIME_PLACEHOLDER }) : null;
    // The runtime parts this module's schema needs (see runtimeFeatures).
    // A registry module's schema reaches the others: what it needs from the
    // registry, by $id, is every schema registered beside it. A key that is
    // not its schema's $id cannot be found by the runtime, which keys the
    // registry by $id: such a module is written self-contained.
    let registryEntries = null;
    let compactOut = compact;
    if (compactOut && others !== null && others.length > 0) {
      // A schema without an $id is not in the registry: its module carries it.
      registryEntries = typeof v._schemaObj.$id === 'string' ? [v._schemaObj] : [];
      for (const [id, sub] of v._schemaMap) {
        if (!sub || typeof sub !== 'object' || sub.$id !== id) { compactOut = null; registryEntries = null; break; }
        registryEntries.push(sub);
      }
    }
    const { stripAnnotations: _strip } = require('./schema-strip');
    const features = compactOut ? require('./error-runtime').runtimeFeatures((registryEntries || [v._schemaObj]).map(_strip)) : null;
    // A module that imports the pattern engine needs it in the runtime,
    // whatever the schema scan said.
    if (features && compactOut.includes('_ataCompileSafe')) features['safe-regex'] = true;
    // Why there is no module, when the reason is a reference: which one, and
    // what would resolve it.
    let unresolved = null;
    if (!src) {
      const miss = {};
      const registry = v._schemaMap && v._schemaMap.size > 0 ? v._schemaMap : null;
      if (!aot._refsResolveWithin(v._schemaObj, registry, miss) && typeof miss.ref === 'string') unresolved = miss.ref;
    }
    return { schema, src, compact: compactOut, features, registryEntries, root: v._schemaObj, usesSiblings: others !== null, unresolved, inputWarnings };
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
        !!cacheEntry.schemaMode === schemaMode &&
        // A module built against the other inputs depends on them too, and
        // the registry is put together from such modules: always rebuilt.
        !cacheEntry.usesSiblings &&
        fs.existsSync(output) &&
        cacheEntry.outputHash === hashContent(fs.readFileSync(output)) &&
        // The Bun target is written beside the module; when it is asked for
        // and missing, the module is rebuilt so that it gets written.
        (opts.target !== 'bun' || fs.existsSync(bunTargetPath(output)))
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
        const reason = r.unresolved !== null
          ? `$ref "${r.unresolved}" does not resolve: no input has that $id. Add the schema it names as an input${opts.baseUri === undefined ? ', and if that file has no $id, give it one with --base-uri' : ''}`
          : 'schema is not AOT-compatible (toStandaloneModule returned null)';
        if (opts.strict) failed.push({ input, error: reason });
        else skipped.push({ input, reason });
        continue;
      }
      entries.push({
        input, output, raw, inputHash, schema: r.schema, src: r.src, compact: r.compact, features: r.features, registryEntries: r.registryEntries, root: r.root, usesSiblings: r.usesSiblings,
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
  const candidates = entries.filter((e) => typeof e.compactGz === 'number' && (schemaMode || errorsMode === 'shared' || e.compactGz < e.fullGz));
  let runtime = null;
  if ((sharable || schemaMode) && candidates.length > 0) {
    const runtimeSrc = errorRuntimeSource(format, ATA_VERSION, unionOf(candidates), schemaMode);
    const runtimeGz = zlib.gzipSync(runtimeSrc).length;
    let saving = 0;
    for (const e of candidates) saving += e.fullGz - e.compactGz;
    const use = schemaMode || errorsMode === 'shared' || saving > runtimeGz;
    if (use) runtime = { path: runtimePathFor(entries.map((e) => e.output), opts, format), src: runtimeSrc, gz: runtimeGz };
  }
  for (const e of entries) {
    e.mode = runtime !== null && candidates.includes(e) ? (schemaMode ? 'schema' : 'compact') : 'inline';
  }
  // The registry the schema modules resolve against: every schema any of them
  // needs, once, by $id.
  let registryPath = null;
  let registrySrc = null;
  if (runtime !== null) {
    const byId = new Map();
    for (const e of entries) if (e.mode !== 'inline' && e.registryEntries) for (const sub of e.registryEntries) if (!byId.has(sub.$id)) byId.set(sub.$id, sub);
    if (byId.size > 0) {
      registryPath = path.join(path.dirname(runtime.path), 'ata-registry' + (format === 'cjs' ? '.cjs' : '.mjs'));
      const roots = entries.filter((e) => e.mode !== 'inline' && e.registryEntries).map((e) => e.root);
      registrySrc = aot.registrySource([...pruneRegistry(roots, byId).values()], format);
    }
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
        if (e.mode !== 'inline' && !r.compact) e.mode = 'inline';
      }
      let src = e.mode !== 'inline'
        ? e.compact.split(JSON.stringify(RUNTIME_PLACEHOLDER)).join(JSON.stringify(importSpecifier(output, runtime.path)))
        : e.src;
      if (e.mode !== 'inline' && e.registryEntries) src = src.split(JSON.stringify(REGISTRY_PLACEHOLDER)).join(JSON.stringify(importSpecifier(output, registryPath)));
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
      const stem = path.basename(input, path.extname(input)).replace(/\.schema$/, '');
      const typeName = stem
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/^([a-z])/, (m) => m.toUpperCase()) || 'Data';
      if (opts.target === 'bun') {
        const { writeBunTarget, Declined } = require('./bun-target');
        try {
          const w = writeBunTarget({ schema: e.schema, input, output, typeName, format });
          bunTargets.push({ input, output: w.bunPath, residual: w.residualPath, definitions: w.definitions, residualKeywords: w.residualKeywords });
        } catch (err) {
          if (!(err instanceof Declined)) throw err;
          // The split cannot be made; the plain module stands alone.
          const reason = `--target bun: ${err.message}; the plain module stands alone`;
          if (opts.strict) { failed.push({ input, error: reason }); continue; }
          bunDeclined.push({ input, reason });
        }
      }
      if (opts.types !== false) {
        const { toTypeScript } = require('./ts-gen');
        const dts = toTypeScript(e.schema, { name: typeName, applyDefaults: /\nfunction applyDefaults\(/.test(src) });
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
        schemaMode,
        mode: e.mode,
        runtime: e.mode !== 'inline' ? runtime.path : undefined,
        fullGz: e.fullGz,
        compactGz: e.compactGz,
        features: e.features || undefined,
        usesSiblings: e.usesSiblings || undefined,
      };
    } catch (err) {
      failed.push({ input, error: err.message });
    }
  }

  let runtimeReport = null;
  if (runtime !== null && entries.some((e) => e.mode !== 'inline')) {
    const current = fs.existsSync(runtime.path) ? fs.readFileSync(runtime.path, 'utf8') : null;
    if (current !== runtime.src) {
      fs.mkdirSync(path.dirname(runtime.path), { recursive: true });
      fs.writeFileSync(runtime.path, runtime.src);
    }
    runtimeReport = { output: runtime.path, bytes: Buffer.byteLength(runtime.src, 'utf8'), gzipBytes: runtime.gz };
    if (registrySrc !== null) {
      const cur = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : null;
      if (cur !== registrySrc) fs.writeFileSync(registryPath, registrySrc);
      runtimeReport.registry = { output: registryPath, bytes: Buffer.byteLength(registrySrc, 'utf8'), gzipBytes: zlib.gzipSync(registrySrc).length };
    }
  }

  writeCache(opts.cacheFile, newCache);

  // The self-contained source is built for every input, so its error-detail
  // decline is recorded even where the module written is a compact or schema
  // module, whose errors come from the runtime. Only the written one counts.
  const fromRuntime = new Set(entries.filter((e) => e.mode !== 'inline').map((e) => e.input));
  const kept = warnings.filter((w) => !(w.kind === 'error-detail' && fromRuntime.has(w.input)));
  return { compiled, cached, skipped, failed, warnings: kept, runtime: runtimeReport, bunTargets, bunDeclined };
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
// A plugin asks for both modules of one schema (the self-contained one, and
// the compact one to compare): one Validator answers both, so the verdict
// function compiles once. Keyed by the schema object the plugin passes.
const _validators = new WeakMap();
function validatorFor(schema) {
  let v = _validators.get(schema);
  // Built with an options object, empty, so it stays out of the identity
  // cache: `new Validator(schema)` in the caller's own code must get its own
  // instance, not this compiled one.
  if (v === undefined) { v = new Validator(schema, {}); _validators.set(schema, v); }
  return v;
}

function compiledModuleFor(schema, opts) {
  if (!compiledEligible(schema)) return null;
  if (opts && typeof opts.errorRuntime === 'string') {
    try {
      const v = validatorFor(schema);
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
    src = aot.toStandaloneModule(validatorFor(schema), {
      format: (opts && opts.format) || 'esm',
      // Errors in the runtime's order, for a reader that does not sort them
      // itself (a form resolver); fromCompiled sorts, so a plugin putting
      // that wrapper around the module leaves it off.
      order: !!(opts && opts.order === true),
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

// For a build plugin: the Bun target (lib/bun-target.js) and the verification
// (lib/verify.js), loaded on first use.
const bunTarget = {
  get schemaToBunType () { return require('./bun-target').schemaToBunType },
  get toBunModule () { return require('./bun-target').toBunModule },
  get writeBunTarget () { return require('./bun-target').writeBunTarget },
  get Declined () { return require('./bun-target').Declined },
  // The generated code's target engine (lib/js-compiler): a plugin that
  // writes for a Bun executable compiled ahead of time sets 'jsc-aot'.
  setTargetEngine (engine) { return require('./js-compiler').setTargetEngine(engine) },
}
const verify = {
  get verifyOne () { return require('./verify').verifyOne },
  get verifySource () { return require('./verify').verifySource },
  get generate () { return require('./verify').generate },
  get renderReport () { return require('./verify').renderReport },
  get ok () { return require('./verify').ok },
}

module.exports = {
  bunTarget,
  verify,
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
