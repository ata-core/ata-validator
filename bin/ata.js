#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function usage() {
  process.stdout.write(`ata-validator CLI

Usage:
  ata compile <schema-file> [options]   Compile one schema to a standalone module.
  ata build   <glob>...    [options]    Compile a project's schemas (glob pattern) per file.

Compile options:
  -o, --output <file>     Output path. Default: <schema-file>.validator.mjs
  -f, --format <fmt>      Module format: esm | cjs. Default: esm
  --name <TypeName>       Name of the top-level type in .d.ts. Default: inferred from filename
  --no-types              Skip .d.ts generation
  --abort-early           Use stub errors (smallest bundle)
  --source                Embed schema source map (default in development)
  --no-source             Omit source map (default in production, NODE_ENV=production)

Build options:
  --out-dir <dir>         Write outputs into this directory instead of alongside sources
  --suffix <str>          Output filename suffix (default: ".compiled")
  -f, --format <fmt>      Module format: esm | cjs. Default: esm
  --abort-early           Use stub errors (smallest bundle)
  --check                 Check (don't write); exit 1 if any output is stale
  --cache-file <path>     Cache file for incremental builds (default: cache disabled)
  --max-size <bytes>      Fail build if any compiled module exceeds this gzipped size
  --strict                Treat any AOT-incompatible schema as a build error (default: skip + warn)
  --watch                 Re-emit on schema change (Ctrl-C to exit)
  --no-types              Skip .d.mts/.d.cts emission alongside compiled modules
  --source                Embed schema source map (default in development)
  --no-source             Omit source map (default in production, NODE_ENV=production)
  --dual                  Emit both .compiled.mjs (with source) and .compiled.min.mjs (without)

  -h, --help              Show this message

Examples:
  ata compile schemas/user.json -o src/generated/user.validator.mjs
  ata build 'schemas/*.json'
  ata build 'src/**/*.schema.json' --out-dir build/validators
`);
}

function parseArgs(argv) {
  const out = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.opts.help = true; continue; }
    if (a === '-o' || a === '--output') { out.opts.output = argv[++i]; continue; }
    if (a === '-f' || a === '--format') { out.opts.format = argv[++i]; continue; }
    if (a === '--name') { out.opts.name = argv[++i]; continue; }
    if (a === '--no-types') { out.opts.types = false; continue; }
    if (a === '--abort-early') { out.opts.abortEarly = true; continue; }
    if (a === '--check') { out.opts.check = true; continue; }
    if (a === '--strict') { out.opts.strict = true; continue; }
    if (a === '--out-dir') { out.opts.outDir = argv[++i]; continue; }
    if (a === '--suffix') { out.opts.suffix = argv[++i]; continue; }
    if (a === '--cache-file') { out.opts.cacheFile = argv[++i]; continue; }
    if (a === '--max-size') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new Error(`--max-size requires a positive integer (got "${v}")`);
      }
      out.opts.maxSize = n;
      continue;
    }
    if (a === '--watch') { out.opts.watch = true; continue; }
    if (a === '--source') { out.opts.source = true; continue; }
    if (a === '--no-source') { out.opts.source = false; continue; }
    if (a === '--dual') { out.opts.dual = true; continue; }
    if (a.startsWith('-')) { throw new Error(`Unknown option: ${a}`); }
    out._.push(a);
  }
  return out;
}

function resolveSourceDefault (opts) {
  if (opts.source === true) return true;
  if (opts.source === false) return false;
  return process.env.NODE_ENV !== 'production';
}

function inferOutput(inputPath, format) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const ext = format === 'cjs' ? '.validator.cjs' : '.validator.mjs';
  return path.join(dir, base + ext);
}

function cmdCompile(args) {
  if (args._.length === 0) {
    process.stderr.write('error: missing <schema-file>\n\n');
    usage();
    process.exit(1);
  }
  const input = args._[0];
  const format = args.opts.format || 'esm';
  if (format !== 'esm' && format !== 'cjs') {
    process.stderr.write(`error: --format must be esm or cjs (got "${format}")\n`);
    process.exit(1);
  }
  const output = args.opts.output || inferOutput(input, format);
  const abortEarly = !!args.opts.abortEarly;

  let schemaStr;
  try {
    schemaStr = fs.readFileSync(input, 'utf8');
  } catch (e) {
    process.stderr.write(`error: cannot read ${input}: ${e.message}\n`);
    process.exit(1);
  }

  let schema;
  try {
    schema = JSON.parse(schemaStr);
  } catch (e) {
    process.stderr.write(`error: ${input} is not valid JSON: ${e.message}\n`);
    process.exit(1);
  }

  const { Validator } = require('..');
  const v = new Validator(schema);
  const source = resolveSourceDefault(args.opts);
  let sourceMap = null;
  if (source) {
    try {
      const { buildPositionMap } = require('../lib/source-positions');
      sourceMap = buildPositionMap(schemaStr);
    } catch {
      sourceMap = null;
    }
  }
  const schemaFile = path.relative(process.cwd(), input) || input;
  const src = v.toStandaloneModule({ format, abortEarly, source, sourceMap, schemaFile });
  if (!src) {
    process.stderr.write('error: schema is too complex for standalone compilation\n');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, src);

  const sizeBytes = Buffer.byteLength(src, 'utf8');
  process.stdout.write(`ata: compiled ${input} -> ${output} (${sizeBytes.toLocaleString()} bytes, ${format}${abortEarly ? ', abort-early' : ''})\n`);

  // Emit paired declaration file unless --no-types.
  // TypeScript resolution: .mjs -> .d.mts, .cjs -> .d.cts, .js -> .d.ts.
  const emitTypes = args.opts.types !== false;
  if (emitTypes) {
    const { toTypeScript } = require('../lib/ts-gen');
    const typeName = args.opts.name || path.basename(input, path.extname(input))
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^([a-z])/, (m) => m.toUpperCase()) || 'Data';
    const dts = toTypeScript(schema, { name: typeName });
    const ext = path.extname(output);
    const dtsExt = ext === '.mjs' ? '.d.mts'
      : ext === '.cjs' ? '.d.cts'
      : '.d.ts';
    const dtsPath = output.slice(0, output.length - ext.length) + dtsExt;
    const finalDtsPath = dtsPath === output ? output + dtsExt : dtsPath;
    fs.writeFileSync(finalDtsPath, dts);
    process.stdout.write(`ata: wrote types       -> ${finalDtsPath}\n`);
  }
}

function cmdBuild(args) {
  if (args._.length === 0) {
    process.stderr.write('error: missing <glob>\n\n');
    usage();
    process.exit(1);
  }
  const buildLib = require('../lib/aot-build');
  const format = args.opts.format || 'esm';
  if (format !== 'esm' && format !== 'cjs') {
    process.stderr.write(`error: --format must be esm or cjs (got "${format}")\n`);
    process.exit(1);
  }
  const buildOpts = {
    globs: args._,
    format,
    outDir: args.opts.outDir,
    suffix: args.opts.suffix,
    abortEarly: !!args.opts.abortEarly,
    check: !!args.opts.check,
    maxSize: args.opts.maxSize,
    strict: !!args.opts.strict,
    types: args.opts.types,
    cacheFile: args.opts.cacheFile,
  };

  const printReport = (report) => {
    if (args.opts.check) {
      process.stdout.write(`ata: check — ${report.cached.length} up to date, ${report.staleCount} stale\n`);
      return;
    }
    for (const c of report.compiled) {
      process.stdout.write(`ata: ${c.input} -> ${c.output} (${c.bytes.toLocaleString()} bytes)\n`);
    }
    for (const c of report.cached) {
      process.stdout.write(`ata: cached  ${c.input}\n`);
    }
    for (const s of report.skipped) {
      process.stdout.write(`ata: skipped ${s.input}: ${s.reason}\n`);
    }
    for (const f of report.failed) {
      process.stderr.write(`ata: failed  ${f.input}: ${f.error}\n`);
    }
  };

  if (args.opts.watch) {
    let handle;
    buildLib.watch(buildOpts, printReport).then((h) => {
      handle = h;
      process.stdout.write('ata: watching for changes (Ctrl-C to exit)\n');
    });
    process.on('SIGINT', () => {
      if (handle) handle.close();
      process.exit(0);
    });
    return;
  }

  buildLib.build(buildOpts).then((report) => {
    printReport(report);
    if (args.opts.check && report.staleCount > 0) process.exit(1);
    if (report.failed.length > 0) process.exit(1);
  }).catch((e) => {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  });
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { usage(); process.exit(0); }

  const cmd = argv[0];
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') { usage(); return; }

  const rest = argv.slice(1);
  let args;
  try {
    args = parseArgs(rest);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }

  if (args.opts.help) { usage(); return; }

  if (cmd === 'compile') {
    cmdCompile(args);
    return;
  }

  if (cmd === 'build') {
    cmdBuild(args);
    return;
  }

  process.stderr.write(`error: unknown command "${cmd}"\n\n`);
  usage();
  process.exit(1);
}

main();
