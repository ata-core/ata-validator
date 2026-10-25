'use strict';

// The core tarball must be pure JS: no binaries, no vendored C++ deps, no
// build system, no install script. Runs `npm pack --dry-run --json` and
// inspects the manifest. Sibling of the browser-imports guard.

const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
// execSync (shell) rather than execFileSync: on Windows npm is npm.cmd,
// which cannot be spawned directly. The command is a static string.
const out = execSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// npm <=11 prints an array of manifests, npm 12 an object keyed by package name
const parsed = JSON.parse(out);
const manifest = Array.isArray(parsed) ? parsed[0] : parsed[Object.keys(parsed)[0]];
assert.ok(manifest && manifest.files, `unrecognized npm pack --json output: ${out.slice(0, 200)}`);
const files = manifest.files.map((f) => f.path);

const forbidden = [
  /\.node$/, /^prebuilds\//, /^deps\//, /^src\//, /^include\//, /^binding\//,
  /^CMakeLists\.txt$/, /^scripts\/install\.js$/, /^binding-options\.js$/,
];
for (const f of files) {
  assert.ok(!forbidden.some((re) => re.test(f)), `tarball must not ship ${f}`);
}

const pkg = require(path.join(root, 'package.json'));
assert.ok(!pkg.scripts.install, 'core must have no install script');
assert.ok(!pkg.dependencies || !pkg.dependencies['pkg-prebuilds'], 'pkg-prebuilds must be gone');
assert.ok(pkg.optionalDependencies, 'optionalDependencies must exist');
for (const [name, ver] of Object.entries(pkg.optionalDependencies)) {
  assert.ok(ver === pkg.version, `${name} must be exact-pinned to the core version (got ${ver})`);
}

// Size ceiling; adjust only with a reviewed reason. It is here to catch weight
// nobody meant to ship, as the changelog once was (13% of the tarball). 300 KB
// until 1.39.0, when three silent-accept fixes, engine-independent error lists
// and the same-value $ref cycle gate took the package past it after comments
// had been trimmed twice to stay under; the same release strips the native
// binaries, which takes 250-300 KB off every install with an addon. 320 KB
// until 1.42.0 (319.7 KB at 1.41.0, 328.8 KB after): errors built enriched in
// generated code, one-pass validation once errors are read, and references
// resolved at compile time, each of which moves schemas or reads off a slower
// path. 336 KB until 1.43.0 (336.2 KB after): definitions written once as
// functions in the combined and large verdict functions, which took a first
// rejection with errors read on SchemaStore's sarif from 129 to 72 ms; oneOf
// and anyOf counted by branch verdicts; and recursive schemas given one-pass
// validation instead of declining it. 340 KB until 1.44.0: an interpreted
// twin answers a large schema's first calls, which took a command line run
// on SARIF from 87 to 31 ms from process start. 344 KB within 1.44.0: the
// simdjson position locator, propertyNames with any subschema generated,
// validateJSON errors kept in validate()'s order and shape on every engine,
// and the schema copies that dropped a name "__proto__" (silent accepts).
// 348 KB until 1.46.0: `ata migrate` (lib/migrate.js), the report of what a
// switch from ajv would change, is about 11 KB of source in the CLI. 352 KB
// within 1.46.0: $dynamicRef unrolled by scope, the run-time
// unevaluatedProperties verdict read from the annotation counts, and finite
// repeats of a group handed to the platform RegExp.
// 376 KB within 1.46.0: the one-pass function's subtree guards, its shared
// run-time module (lib/combined-runtime.js) and run-time unevaluatedProperties
// written as straight-line code with a bitmask (inlineUnevalBlock).
// 392 KB within 1.47.0: the one-pass error path for standalone modules
// (onePassCore and its closure serializer in lib/aot-impl.js), the generator's
// vacuous-emission check, and the split of lib/js-compiler.js (the two files
// carry the shared-helper lists). Measured 386 KB at the time.
// 400 KB within 1.49.0: compact modules, whose errors come from one runtime
// a build writes beside them (lib/error-runtime.js packs it from the library's
// own files, lib/error-runtime-entry.js, lib/schema-strip.js, lib/error-sort.js
// split out of rejections.js). Measured 395 KB at the time.
// 404 KB within 1.49.0: the error runtime as a package entry
// (error-runtime.js), its rank sort (lib/error-sort-rank.js) and code table
// (lib/error-code-of.js), and the interpreter split in two
// (lib/interpreter-core.js). Measured 400.1 KB at the time.
// 408 KB within 1.49.0: the edge entry (index.edge.js, index.edge.mjs), the
// tools as separate ES imports (lib/tools.mjs) and index.js split into
// lib/codegen-engine.js and lib/public-api.js. Measured 405.1 KB at the time.
// 412 KB after 1.50.0: schema modules over a shared registry for schemas
// that reference each other (lib/aot-build.js, lib/aot-impl.js), and the
// error order following a reference into another document
// (lib/schema-order.js). Measured 410.2 KB at the time.
// 416 KB with `ata build --base-uri` and the registry pruned to the
// definitions its modules reach (lib/aot-build.js). Measured 412.2 KB.
// 420 KB after 1.52.0: own-key loops in both generators (lib/js-compiler.js),
// the swap-aware typo distance (lib/levenshtein.js) and the compat error path
// (compat.js, lib/compat-errors.js). Measured 416.2 KB.
// 432 KB with compat reading OpenAPI validators' setup: coercion where each
// type is checked, the discriminator option, defaults behind $ref and the
// reference's schema paths (compat.js, lib/compat-errors.js,
// lib/interpreter-core.js). Measured 427.5 KB.
// 436 KB with compat's interpreter additions in a file of their own, the
// generated code's self-loop rewrite, preamble checks and the delimited-loop
// regex rule (lib/interpreter-compat.js, lib/js-compiler.js,
// lib/regex-linear.js). Measured 432.8 KB.
// 440 KB with a required key holding undefined read as missing in every
// engine, and the generated code shapes that keep SchemaStore's schemas at
// 1.53.0's speed or better (lib/js-compiler.js, lib/plan-compiler.js).
// Measured 436.6 KB.
// 444 KB with draft-04 as a dialect and its vendored meta-schema, definitions
// that refer back to the root compiled, and the linear regex engine's loop
// reading its tables through locals (popxf 18% faster). Measured 440.1 KB.
// 448 KB with the browser build's on-demand code generator (lib/tiering.js,
// the ata-validator/codegen entry). Measured 445.1 KB.
// 452 KB with the browser build warming the engine and building validators'
// engines while the page is idle (lib/tiering.js), and plain linear patterns
// on the platform RegExp in the interpreted engine (lib/interpreter-core.js):
// a form's first submit in Chrome 18.56 to 2.48 ms with the CPU slowed 4x.
// Measured 449.6 KB.
// 456 KB with standalone modules exporting applyDefaults and, asked for with
// `order: true`, handing out their errors in the runtime's order
// (lib/aot-order.js), so a module read directly, as a form resolver does,
// answers as the runtime Validator does. Measured 452.6 KB.
// 460 KB with defaults filled in every schema applied to a value, as ajv's
// useDefaults fills them, in the closure pass, the generated pass, parse()
// and the modules' applyDefaults (lib/defaults.js, lib/codegen-engine.js,
// lib/clone-emit.js, lib/aot-impl.js). Measured 456.5 KB.
// 464 KB with bundleStandalone answering as the runtime does: errors in the
// runtime's order with `order`, coerceTypes and removeAdditional run before
// the check instead of left out (a module that rejected what the runtime
// accepts), and each validator's applyDefaults, which rjsf's precompiled
// validator needs to match its runtime one. Measured 460.4 KB.
// 476 KB with `ata build --target bun`: lib/bun-target.js writes the schema's
// rules as a type for Bun's validate<T>, with the plain module deciding where
// the type refuses, and the build and CLI carry the option. Measured 470.3 KB.
// 486 KB with the type split into a type and a residual schema (every schema
// with a type gets a Bun target) and `ata verify` (lib/verify.js: documents
// made from a schema, samples read, module held against the runtime, stale
// modules reported). Measured 480.2 KB.
assert.ok(manifest.size < 486 * 1024, `tarball ${manifest.size} bytes exceeds ceiling (adjust only with a reviewed reason)`);

console.log(`ok: core tarball is pure JS (${files.length} files, ${manifest.size} bytes packed)`);
