'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Validator } = require('..');
const { buildPositionMap } = require('./source-positions');

function resolveSourceDefault (opts) {
  if (opts.source === true) return true;
  if (opts.source === false) return false;
  return process.env.NODE_ENV !== 'production';
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
      const m = g.match(/^(.*?)(?:\/\*\.(.+))?$/);
      const dir = m && m[1] ? m[1] : '.';
      const ext = m && m[2] ? '.' + m[2] : null;
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

async function build(opts) {
  const globs = opts.globs || [];
  if (globs.length === 0) throw new Error('build: at least one glob required');
  const format = opts.format || 'esm';
  const inputs = await expandGlobs(globs);
  const cache = readCache(opts.cacheFile);
  const newCache = {};

  const compiled = [];
  const cached = [];
  const skipped = [];
  const failed = [];

  for (const input of inputs) {
    try {
      const raw = fs.readFileSync(input);
      const inputHash = hashContent(raw);
      const output = outputPathFor(input, { ...opts, format });
      const cacheEntry = cache[input];
      if (opts.check) {
        const upToDate = (
          cacheEntry &&
          cacheEntry.inputHash === inputHash &&
          cacheEntry.output === output &&
          fs.existsSync(output) &&
          cacheEntry.outputHash === hashContent(fs.readFileSync(output))
        );
        if (upToDate) {
          cached.push({ input, output });
        }
        continue;
      }
      if (
        cacheEntry &&
        cacheEntry.inputHash === inputHash &&
        cacheEntry.output === output &&
        fs.existsSync(output) &&
        cacheEntry.outputHash === hashContent(fs.readFileSync(output))
      ) {
        cached.push({ input, output });
        newCache[input] = cacheEntry;
        continue;
      }
      const schema = parseSchemaFile(input);
      const v = new Validator(schema);
      const source = resolveSourceDefault(opts);
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
      const src = v.toStandaloneModule({
        format,
        abortEarly: !!opts.abortEarly,
        source,
        sourceMap,
        schemaFile,
      });
      if (!src) {
        const reason = 'schema is not AOT-compatible (toStandaloneModule returned null)';
        if (opts.strict) failed.push({ input, error: reason });
        else skipped.push({ input, reason });
        continue;
      }
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, src);
      const outBytes = Buffer.byteLength(src, 'utf8');
      const gz = zlib.gzipSync(src);
      const gzBytes = gz.length;
      if (typeof opts.maxSize === 'number' && gzBytes > opts.maxSize) {
        // Roll back the write so a failed build doesn't leave a stale artifact.
        try { fs.unlinkSync(output); } catch {}
        failed.push({ input, error: `output ${output} exceeds --max-size: ${gzBytes} > ${opts.maxSize} (gzipped bytes)` });
        continue;
      }
      compiled.push({ input, output, bytes: outBytes, gzipBytes: gzBytes });
      if (opts.types !== false) {
        const { toTypeScript } = require('./ts-gen');
        const stem = path.basename(input, path.extname(input)).replace(/\.schema$/, '');
        const typeName = stem
          .replace(/[^A-Za-z0-9_]/g, '_')
          .replace(/^([a-z])/, (m) => m.toUpperCase()) || 'Data';
        const dts = toTypeScript(schema, { name: typeName });
        const ext = path.extname(output);
        const dtsExt = ext === '.mjs' ? '.d.mts'
          : ext === '.cjs' ? '.d.cts'
          : '.d.ts';
        const base = output.slice(0, output.length - ext.length);
        fs.writeFileSync(base + dtsExt, dts);
      }
      newCache[input] = {
        inputHash,
        output,
        outputHash: hashContent(Buffer.from(src, 'utf8')),
      };
    } catch (e) {
      failed.push({ input, error: e.message });
    }
  }

  if (opts.check) {
    const staleCount = inputs.length - cached.length;
    return { compiled: [], cached, skipped, failed, staleCount };
  }

  writeCache(opts.cacheFile, newCache);

  return { compiled, cached, skipped, failed };
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

module.exports = { build, expandGlobs, parseSchemaFile, outputPathFor, watch };
