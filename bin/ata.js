#!/usr/bin/env node
'use strict';
const { env } = require('../lib/env');

const fs = require('fs');
const path = require('path');

function usage() {
  process.stdout.write(`ata-validator CLI

Usage:
  ata compile  <schema-file> [options]  Compile one schema to a standalone module.
  ata build    <glob>...     [options]  Compile a project's schemas (glob pattern) per file.
  ata validate <schema> <data> [options] Validate a JSON data file against a schema.
  ata migrate  [dir]         [options]  Report what switching from ajv would change; --write applies it.
  ata verify   <glob>...     [options]  Check that each schema's compiled module answers as the runtime
                                        does, on generated documents and the project's samples.

Verify options:
  --generate <n>          Documents made from each schema, half with one rule broken. Default: 200
  --samples <path>        A JSON, JSON Lines file or a directory of them, checked too (repeatable)
  --seed <n>              Seed for the generated documents. Default: 1
  --json                  Report as JSON
  --out-dir, --suffix, --format    Where the modules are, as given to ata build

Validate options:
  --pretty                Render errors with source frames (default on TTY)
  --compact               Render errors as one line each (default when piped)
  --format <fmt>          Output format: pretty | compact | json
  --max-errors <n>        Limit pretty output to N errors (0 = no limit). Default: 20
  --color <when>          Color output: auto | always | never. Default: auto
  --no-color              Disable color output (alias for --color=never)

Compile options:
  -o, --output <file>     Output path. Default: <schema-file>.validator.mjs
  -f, --format <fmt>      Module format: esm | cjs. Default: esm
  --name <TypeName>       Name of the top-level type in .d.ts. Default: inferred from filename
  --no-types              Skip .d.ts generation
  --abort-early           Use stub errors (smallest bundle)
  --one-pass              Report errors with the runtime's one-pass function: faster on
                          rejected documents, a module 1.3 to 1.7x the size
  --order                 Hand errors out in the runtime's order (schema declaration
                          order) rather than the order they were found in; adds a sort,
                          and for a schema with $ref its key skeleton
  --source                Embed schema source map (default in development)
  --no-source             Omit source map (default in production, NODE_ENV=production)

Migrate options:
  --write                 Apply the mechanical changes (import specifiers, addFormats calls).
                          Without it the command only reports. Exit code 1 when a site
                          needs a reader, so it can run as a readiness check in CI.

Build options:
  --out-dir <dir>         Write outputs into this directory instead of alongside sources
  --suffix <str>          Output filename suffix (default: ".compiled")
  -f, --format <fmt>      Module format: esm | cjs. Default: esm
  --abort-early           Use stub errors (smallest bundle)
  --one-pass              Report errors with the runtime's one-pass function: faster on
                          rejected documents, a module 1.3 to 1.7x the size
  --order                 Hand errors out in the runtime's order (schema declaration
                          order) rather than the order they were found in; adds a sort,
                          and for a schema with $ref its key skeleton (modules that share
                          the error runtime are in that order already)
  --errors <mode>         Where error detail comes from: auto | inline | shared. auto
                          (default) has modules share one error runtime file when that
                          makes the output smaller; production builds only (--no-source)
  --mode <mode>           code (default) | schema. schema writes each module as its
                          schema and takes the verdict and errors from one runtime
                          file: far smaller and quicker to load, slower per check
  --base-uri <uri>        The URI an input without $id is known by: <uri> plus its
                          file name, for schemas that reference a shared file by URL
                          or relative path
  --check                 Check (don't write); exit 1 if any output is stale
  --cache-file <path>     Cache file for incremental builds (default: cache disabled)
  --max-size <bytes>      Fail build if any compiled module exceeds this gzipped size
  --strict                Treat any AOT-incompatible schema as a build error (default: skip + warn)
  --target bun            Write every module for Bun's ahead-of-time compiler, and beside
                          each a .bun.ts with the schema as a TypeScript type and a typed
                          parse(text); the plain module answers every check
  --strict-schema         Fail the build on schema authoring mistakes: unknown
                          keywords (with a spelling suggestion), keywords the
                          node's type makes inert, unresolvable local $refs,
                          and required names nothing can satisfy
  --watch                 Re-emit on schema change (Ctrl-C to exit)
  --no-types              Skip .d.mts/.d.cts emission alongside compiled modules
  --source                Embed schema source map (default in development)
  --no-source             Omit source map (default in production, NODE_ENV=production)
  --dual                  Emit both .compiled.mjs (with source) and .compiled.min.mjs (without)

  -h, --help              Show this message
  -V, --version           Print the ata-validator version

Examples:
  ata compile schemas/user.json -o src/generated/user.validator.mjs
  ata build 'schemas/*.json'
  ata build 'src/**/*.schema.json' --out-dir build/validators
  ata validate schemas/user.json payload.json --pretty
`);
}

function parseArgs(argv) {
  const out = { _: [], opts: {} };
  // Normalize --key=value into --key value pairs so equals-form is accepted
  // for every option without per-option branches below.
  const normalized = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      normalized.push(a.slice(0, eq), a.slice(eq + 1));
    } else {
      normalized.push(a);
    }
  }
  argv = normalized;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.opts.help = true; continue; }
    if (a === '-o' || a === '--output') { out.opts.output = argv[++i]; continue; }
    if (a === '-f' || a === '--format') { out.opts.format = argv[++i]; continue; }
    if (a === '--name') { out.opts.name = argv[++i]; continue; }
    if (a === '--no-types') { out.opts.types = false; continue; }
    if (a === '--abort-early') { out.opts.abortEarly = true; continue; }
    if (a === '--one-pass') { out.opts.onePass = true; continue; }
    if (a === '--order') { out.opts.order = true; continue; }
    if (a === '--errors') { out.opts.errors = argv[++i]; continue; }
    if (a === '--mode') { out.opts.mode = argv[++i]; continue; }
    if (a === '--base-uri') { out.opts.baseUri = argv[++i]; continue; }
    if (a === '--check') { out.opts.check = true; continue; }
    if (a === '--strict') { out.opts.strict = true; continue; }
    if (a === '--strict-schema') { out.opts.strictSchema = true; continue; }
    if (a === '--target') { out.opts.target = argv[++i]; continue; }
    if (a === '--generate') { out.opts.generate = Number(argv[++i]); continue; }
    if (a === '--samples') { (out.opts.samples = out.opts.samples || []).push(argv[++i]); continue; }
    if (a === '--seed') { out.opts.seed = Number(argv[++i]); continue; }
    if (a === '--json') { out.opts.json = true; continue; }
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
    if (a === '--write') { out.opts.write = true; continue; }
    if (a === '--source') { out.opts.source = true; continue; }
    if (a === '--no-source') { out.opts.source = false; continue; }
    if (a === '--dual') { out.opts.dual = true; continue; }
    if (a === '--pretty') { out.opts.pretty = true; continue; }
    if (a === '--compact') { out.opts.compact = true; continue; }
    if (a === '--no-color') { out.opts.noColor = true; continue; }
    if (a === '--color') { out.opts.color = argv[++i]; continue; }
    if (a === '--max-errors') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        throw new Error(`--max-errors requires a non-negative integer (got "${v}")`);
      }
      out.opts.maxErrors = n;
      continue;
    }
    if (a.startsWith('-')) { throw new Error(`Unknown option: ${a}`); }
    out._.push(a);
  }
  return out;
}

function resolveSourceDefault (opts) {
  if (opts.source === true) return true;
  if (opts.source === false) return false;
  return env('NODE_ENV') !== 'production';
}

function inferOutput(inputPath, format) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const ext = format === 'cjs' ? '.validator.cjs' : '.validator.mjs';
  return path.join(dir, base + ext);
}

// Renders a schema-compile failure through the structured error pipeline so
// `ata compile` / `ata build` surface the same look-and-feel as runtime
// validation errors. The actual position of the schema flaw isn't known here
// (parsing or codegen already bailed), so schemaSource is left undefined.
function reportCompileError (schemaFile, message) {
  const { renderPretty, renderCompact } = require('..');
  const fmt = process.stdout.isTTY ? 'pretty' : 'compact';
  const err = {
    code: 'ATA9002',
    keyword: '__compile__',
    path: '',
    message,
    schemaSource: undefined,
    docUrl: 'https://ata-validator.com/e/ATA9002',
  };
  const out = fmt === 'pretty'
    ? renderPretty([err], { color: 'auto', context: schemaFile })
    : renderCompact([err], { color: 'auto', context: schemaFile });
  process.stderr.write(out + '\n');
}

function cmdCompile(args) {
  if (args._.length === 0) {
    process.stderr.write('error: missing <schema-file>\n\n');
    usage();
    process.exit(1);
  }
  const input = args._[0];
  // With no --format, the output filename already says what the caller wants:
  // -o validator.cjs used to emit an ES module into a .cjs file, which Node
  // then refused to load.
  const extFormat = args.opts.output && /\.cjs$/.test(args.opts.output) ? 'cjs'
    : args.opts.output && /\.mjs$/.test(args.opts.output) ? 'esm'
    : null;
  const format = args.opts.format || extFormat || 'esm';
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
    reportCompileError(input, `cannot read ${input}: ${e.message}`);
    process.exit(1);
  }

  let schema;
  try {
    schema = JSON.parse(schemaStr);
  } catch (e) {
    reportCompileError(input, `${input} is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  // The build is where an authoring mistake is cheapest to stop: a typo like
  // maxLenght compiles into a module that simply lacks the rule, and nobody
  // revisits a compiled module. Findings fail the compile, with the path and
  // the suggested spelling.
  if (args.opts.strictSchema) {
    const { checkSchemaStrict } = require('../lib/strict-check');
    const problems = checkSchemaStrict(schema, {});
    if (problems.length > 0) {
      for (const x of problems) reportCompileError(input, `strict mode: ${x.message} at ${x.path}`);
      process.exit(1);
    }
  }

  const { Validator } = require('..');
  const aot = require('../lib/aot');
  // `--target bun`: the module is written for JavaScriptCore, the engine the
  // executable the target is for runs on.
  if (args.opts.target === 'bun') {
    require('../lib/js-compiler').setTargetEngine('jsc-aot');
    // The executable's module answers rejections with the one-pass error
    // function and carries no schema-source frames unless asked for.
    if (args.opts.onePass === undefined) args.opts.onePass = true;
    if (args.opts.source === undefined) args.opts.source = false;
  }
  let v;
  try {
    v = new Validator(schema);
  } catch (e) {
    reportCompileError(input, e.message);
    process.exit(1);
  }
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
  const compileWarnings = [];
  const src = aot.toStandaloneModule(v, { format, abortEarly, source, sourceMap, schemaFile, onePass: args.opts.onePass === true ? true : undefined, order: args.opts.order === true ? true : undefined, onWarning: (w) => compileWarnings.push(w) });
  if (compileWarnings.length > 0) {
    if (args.opts.strict) {
      for (const w of compileWarnings) reportCompileError(input, w);
      process.exit(1);
    }
    for (const w of compileWarnings) process.stderr.write(`ata: warning: ${input}: ${w}\n`);
  }
  if (!src) {
    reportCompileError(input, 'schema is too complex for standalone compilation');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, src);

  const sizeBytes = Buffer.byteLength(src, 'utf8');
  process.stdout.write(`ata: compiled ${input} -> ${output} (${sizeBytes.toLocaleString()} bytes, ${format}${abortEarly ? ', abort-early' : ''})\n`);

  if (args.opts.target !== undefined) {
    if (args.opts.target !== 'bun') {
      reportCompileError(input, `--target must be bun (got ${JSON.stringify(args.opts.target)})`);
      process.exit(1);
    }
    const { writeBunTarget, Declined } = require('../lib/bun-target');
    const tn = (args.opts.name || path.basename(input, path.extname(input)).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([a-z])/, (m) => m.toUpperCase())) || 'Data';
    try {
      const w = writeBunTarget({ schema, input, output, typeName: tn });
      process.stdout.write(`ata: bun target -> ${w.bunPath} (for bun build --compile --aot)\n`);
    } catch (e) {
      if (!(e instanceof Declined)) throw e;
      // No type can be written; the plain module stands alone.
      const msg = `--target bun: ${e.message}; the plain module stands alone`;
      if (args.opts.strict) { reportCompileError(input, msg); process.exit(1); }
      process.stderr.write(`ata: warning: ${input}: ${msg}\n`);
    }
  }

  // Emit paired declaration file unless --no-types.
  // TypeScript resolution: .mjs -> .d.mts, .cjs -> .d.cts, .js -> .d.ts.
  const emitTypes = args.opts.types !== false;
  if (emitTypes) {
    const { toTypeScript } = require('../lib/ts-gen');
    const typeName = args.opts.name || path.basename(input, path.extname(input))
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^([a-z])/, (m) => m.toUpperCase()) || 'Data';
    const dts = toTypeScript(schema, { name: typeName, applyDefaults: /\nfunction applyDefaults\(/.test(src) });
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
  if (args.opts.target !== undefined && args.opts.target !== 'bun') {
    process.stderr.write(`error: --target must be bun (got ${JSON.stringify(args.opts.target)})\n`);
    process.exit(1);
  }
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
    onePass: args.opts.onePass === true ? true : undefined,
    order: args.opts.order === true ? true : undefined,
    errors: args.opts.errors,
    mode: args.opts.mode,
    baseUri: args.opts.baseUri,
    check: !!args.opts.check,
    maxSize: args.opts.maxSize,
    strict: !!args.opts.strict,
    target: args.opts.target,
    types: args.opts.types,
    cacheFile: args.opts.cacheFile,
    // Forward the explicit user choice (true / false / undefined). The
    // aot-build module applies the NODE_ENV-aware default when undefined.
    source: args.opts.source,
  };

  const printReport = (report) => {
    if (args.opts.check) {
      process.stdout.write(`ata: check — ${report.cached.length} up to date, ${report.staleCount} stale\n`);
      return;
    }
    for (const c of report.compiled) {
      process.stdout.write(`ata: ${c.input} -> ${c.output} (${c.bytes.toLocaleString()} bytes${c.errors === 'compact' ? ', shared errors' : c.errors === 'schema' ? ', schema module' : ''})\n`);
      for (const t of (report.bunTargets || []).filter((t) => t.input === c.input)) process.stdout.write(`ata: bun target -> ${t.output} (for bun build --compile --aot)\n`);
      for (const d of (report.bunDeclined || []).filter((d) => d.input === c.input)) process.stderr.write(`ata: warning: ${d.input}: ${d.reason}\n`);
    }
    if (report.runtime) {
      process.stdout.write(`ata: error runtime -> ${report.runtime.output} (${report.runtime.bytes.toLocaleString()} bytes, shared by the modules above)\n`);
      if (report.runtime.registry) process.stdout.write(`ata: schema registry -> ${report.runtime.registry.output} (${report.runtime.registry.bytes.toLocaleString()} bytes, the schemas the modules above reference)\n`);
    }
    // A module the error generator declined still has an exact verdict, but
    // every failure is the one ATA9000 error. Said once per module, short,
    // and once with what to do about it.
    let noDetail = 0;
    for (const w of report.warnings || []) {
      if (w.kind === 'error-detail') {
        noDetail++;
        process.stderr.write(`ata: warning ${w.input}: no error detail, failures report the single ATA9000 error (the verdict is exact)\n`);
      } else {
        process.stderr.write(`ata: warning ${w.input}: ${w.warning}\n`);
      }
    }
    if (noDetail > 0 && args.opts.mode !== 'schema') {
      process.stderr.write(`ata: ${noDetail} module${noDetail === 1 ? '' : 's'} without error detail; with --mode schema a module takes its errors from the interpreted engine instead\n`);
    }
    for (const c of report.cached) {
      process.stdout.write(`ata: cached  ${c.input}\n`);
    }
    for (const s of report.skipped) {
      process.stdout.write(`ata: skipped ${s.input}: ${s.reason}\n`);
    }
    for (const f of report.failed) {
      reportCompileError(f.input, f.error);
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

  // --dual emits two artifacts per schema: one source-mapped (default suffix)
  // and one stripped (suffix .compiled.min). Useful for shipping both a
  // developer-friendly bundle and a production-lean one from a single build.
  const dual = !!args.opts.dual;
  const runs = dual
    ? [
      { ...buildOpts, source: true, suffix: args.opts.suffix || '.compiled' },
      { ...buildOpts, source: false, suffix: (args.opts.suffix || '.compiled') + '.min' },
    ]
    : [buildOpts];

  (async () => {
    let anyFailed = false;
    let anyStale = false;
    for (const run of runs) {
      const report = await buildLib.build(run);
      printReport(report);
      if (args.opts.check && report.staleCount > 0) anyStale = true;
      if (report.failed.length > 0) anyFailed = true;
    }
    if (anyFailed || anyStale) process.exit(1);
  })().catch((e) => {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  });
}

function cmdVerify (args) {
  if (args._.length === 0) {
    process.stderr.write('error: missing <glob>\n\n');
    usage();
    process.exit(1);
  }
  const buildLib = require('../lib/aot-build');
  const { verifyOne, renderReport, ok } = require('../lib/verify');
  const format = args.opts.format || 'esm';
  (async () => {
    const inputs = await buildLib.expandGlobs(args._);
    if (inputs.length === 0) {
      process.stderr.write(`error: no schema files match ${args._.join(' ')}\n`);
      process.exit(1);
    }
    const reports = [];
    for (const input of inputs) {
      let schema;
      try { schema = buildLib.parseSchemaFile(input); } catch (e) { reports.push({ schema: input, module: '', error: e.message, documents: 0, agree: 0, disagreements: [] }); continue; }
      const moduleFile = buildLib.outputPathFor(input, { format, outDir: args.opts.outDir, suffix: args.opts.suffix });
      reports.push(await verifyOne({ schemaFile: input, moduleFile, schema, generate: Number.isFinite(args.opts.generate) ? args.opts.generate : 200, seed: Number.isFinite(args.opts.seed) ? args.opts.seed : 1, samples: args.opts.samples || [] }));
    }
    process.stdout.write(renderReport(reports, { json: !!args.opts.json }) + '\n');
    process.exit(reports.every(ok) ? 0 : 1);
  })().catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exit(1); });
}

function cmdValidate (args) {
  if (args._.length < 2) {
    process.stderr.write('error: ata validate <schema> <data-file>\n');
    process.exit(2);
  }
  const [schemaPath, dataPath] = args._;

  let schemaContent;
  try {
    schemaContent = fs.readFileSync(schemaPath, 'utf8');
  } catch (e) {
    process.stderr.write(`error: cannot read ${schemaPath}: ${e.message}\n`);
    process.exit(2);
  }

  let schema;
  try {
    schema = JSON.parse(schemaContent);
  } catch (e) {
    process.stderr.write(`error: ${schemaPath} is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }

  let data;
  try {
    data = fs.readFileSync(dataPath, 'utf8');
  } catch (e) {
    process.stderr.write(`error: cannot read ${dataPath}: ${e.message}\n`);
    process.exit(2);
  }

  const { Validator, renderPretty, renderCompact, renderJSON } = require('..');
  let v;
  try {
    v = new Validator(schema, { source: { path: schemaPath, content: schemaContent } });
  } catch (e) {
    process.stderr.write(`error: schema compile failed: ${e.message}\n`);
    process.exit(2);
  }

  const r = v.validateJSON(data);
  if (r.valid) { process.exit(0); }

  const fmt = args.opts.format
    || (args.opts.pretty ? 'pretty' : args.opts.compact ? 'compact' : null)
    || (process.stdout.isTTY ? 'pretty' : 'compact');
  const colorOpt = args.opts.color || (args.opts.noColor ? 'never' : 'auto');
  const ctx = `${dataPath} against ${schemaPath}`;
  let out;
  if (fmt === 'json') {
    out = renderJSON(r.errors, { pretty: true, context: ctx });
  } else if (fmt === 'pretty') {
    out = renderPretty(r.errors, { color: colorOpt, context: ctx, maxErrors: args.opts.maxErrors });
  } else if (fmt === 'compact') {
    out = renderCompact(r.errors, { color: colorOpt, context: ctx });
  } else {
    process.stderr.write(`error: --format must be pretty, compact, or json (got "${fmt}")\n`);
    process.exit(2);
  }
  process.stderr.write(out + '\n');
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { usage(); process.exit(0); }

  const cmd = argv[0];
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') { usage(); return; }
  if (cmd === '-V' || cmd === '--version' || cmd === 'version') {
    process.stdout.write(require('../package.json').version + '\n');
    return;
  }

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

  if (cmd === 'validate') {
    cmdValidate(args);
    return;
  }

  if (cmd === 'verify') {
    cmdVerify(args);
    return;
  }

  if (cmd === 'migrate') {
    const { migrate, formatReport } = require('../lib/migrate');
    const result = migrate(args._[0] || '.', { write: !!args.opts.write });
    process.stdout.write(formatReport(result, { write: !!args.opts.write }) + '\n');
    // Non-zero when something needs a reader, so the command works as a
    // readiness check in CI.
    process.exit(result.flagged > 0 ? 1 : 0);
  }

  process.stderr.write(`error: unknown command "${cmd}"\n\n`);
  usage();
  process.exit(1);
}

main();
