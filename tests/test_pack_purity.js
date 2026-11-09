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
// 492 KB with generated code written in one form per target engine
// (lib/js-compiler.js: setTargetEngine, the jsc-aot form for an executable
// compiled ahead of time), the Node entry warming the engine once the loop is
// free (index.js: a server's first verdict 3.3 to 0.6 ms), the error
// collector reading each property once behind helper functions that read no
// flag of their caller (lib/js-compiler-errors.js), and the Bun section of
// the README. Measured 486.1 KB.
// 496 KB with the wrappers a bundler plugin puts in place of a validator
// it can see whole (compiled-object, compiled-plain, compiled-bare,
// compiled-bare-rich), the browser stubs that keep the native engine's
// tables out of a page (lib/native-message, lib/native-codes) and the JSON
// rejection apart from validate()'s (lib/json-rejections.js). A two-validator
// form app went from 16.7 to 10.7 KB gzipped, or 3.1 with richErrors: false.
// Measured 493.7 KB.
// 500 KB with the wrapper that carries `~standard` alone (compiled-standard,
// for a validator a bundler plugin sees handed only to a Standard Schema
// consumer: a Hono route on Workers 21.0 to 12.2 KB gzipped), the tier-0
// format check and the "aot" entries. Measured 497.3 KB.
// 501 KB with the README opening on the type and the schema: the typed
// `defineSchema` example and `schemaOf<T>()`, the two directions in one place.
// Measured 500.2 KB.
// 507 KB with `ata-validator/stream` (stream.js, stream.mjs, stream.d.ts,
// lib/stream.js): validation as the body arrives, a JSON array or NDJSON
// split and validated record by record as the chunks land. Measured 506.1 KB.
// 525 KB with the fixes from an outside scan of 104 findings: the native
// engine's format checks ported from lib/formats.js and its On-Demand and
// walker fixes (src/ata.cpp and the single-header copy both ship), the
// numeric-literal guard and shared-definition pass in the code generator,
// the bounded passes in the tools. Measured 524.0 KB.
// 526 KB with ata-validator/aot fixed for browser bundles: a browser twin of
// lib/error-runtime.js and its pure helpers in lib/error-runtime-features.js,
// so esbuild bundles the entry and bundleStandalone compiles in a page.
// Measured 525.2 KB.
// 527 KB with defineSchema and schemaOf outside the validator core and the
// browser, edge and bundler entries reading their names through calls marked
// pure: a module that imports only defineSchema had carried the whole runtime
// into a bundle, 200 to 490 KB before minification, and now carries under
// 1 KB. Measured 526.2 KB.
// 554 KB with ata-validator/ir and ata-validator/kernels: the schema compiler
// built on one definition per keyword (lib/ir: a front end, a backend that
// writes modules and one that builds closures) and the helpers its modules
// import, so a page with several schemas carries them once. Measured 552.9 KB.
// 556 KB with the IR's error order (the check for which schemas need sorting,
// the skeleton it sorts against) and its list of keywords that carry a
// meaning. Measured 554.8 KB.
// 562 KB with lib/kernels/formats.mjs and rank.mjs, the generated copies of
// the format checks and the rank functions that IR modules import, so a page
// split into chunks shares one copy of each. Measured 560.7 KB.
// 564 KB with lib/kernels/preprocess.mjs, the generated copy of the
// coerceTypes and removeAdditional passes the IR runs. Measured 562.8 KB.
// 567 KB with lib/kernels/custom.mjs and the IR's custom keywords, custom
// formats and errorMessage. Measured 565.3 KB.
// 569 KB with the IR's verbose, abortEarly, unresolved references, option
// values and relative schema names. Measured 567.6 KB.
// 572 KB with the IR's walk for keywords that read their data's context.
// Measured 570.5 KB.
// 573 KB with lib/ir/emit-deps.mjs, the generated copy of the pattern
// unrolling and the format hints that lets the module writer load in a
// browser without the code generator. Measured 572.4 KB.
// 574 KB with the closures' walk over an object's own names for a verdict,
// which took their median verdict on SchemaStore with code generation blocked
// from 3.70x the interpreter's to 2.95x. Measured 573.2 KB.
// 577 KB with the module writer's verdict moves (a table of functions for an
// object's names, large bodies as functions of their value, long enums as
// Sets, no paths in calls that gather no errors), which took its median
// verdict on SchemaStore from 1.28x the code generator's to 1.09-1.12x (three runs) and its
// worst from 25x to 6x. Measured 575.9 KB.
// 578 KB with the kernels' bounded typo distance (the banded one of
// lib/levenshtein.js) and branch keywords that build errors only when they
// fail, which took the module writer's median errors read on SchemaStore
// from 1.16x the code generator's to 0.91x and its p90 from 10.3x to 1.27x.
// Measured 577.05 KB.
// 579 KB with verdicts that read unevaluatedProperties' evaluated names off
// the schema and annotation sets made on first use (yamllint's verdict 1153
// to 279 ns, vector's 47.9 to 24.6 us). Measured 578.45 KB.
// 580 KB with default fills that keep an object in V8's fast mode (htmlhint's
// verdict 1465 to 394 ns), fills that walk an object's own names when many
// properties have defaults inside (tslint 1034 to 616 ns), walked keys told
// apart by length, and the default verdict on the interpreted engine where
// code generation is blocked (670 to 365 ns). Measured 579.74 KB.
// 581 KB with a bit per default name for objects with 24 or more defaults,
// set in one pass over the object's own names (10 SchemaStore schemas faster,
// none slower; rustfmt 1371 to 751 ns). Measured 580.46 KB.
// 582 KB with known-name checks told apart by length, and the runtime's
// generated defaults pass handed to the module writer where its own fill
// declines (ata-validator/build defaultsSource; 20 of the 22 SchemaStore
// schemas it changes faster, none slower). Measured 581.1 KB.
// 583 KB with a small schema's first calls answered on the interpreted engine
// alone once a process has met many schemas (2000 schemas compiled at 13.6
// against 59 us each, 8.37 against 8.57 KB per validator). Measured 582.94 KB.
// 584 KB with calls on a cycle cut in the IR's module and closures (an allOf
// that refers back to its own node threw RangeError where the current engine
// answers; SchemaStore's cloudify). Measured 583.87 KB.
// 589 KB with ES module copies of lib/unique-items.js and lib/branch-collapse.js
// in lib/kernels, so ata-validator/kernels reaches no CommonJS file: Next.js
// with webpack kept six CommonJS files beside a compiled form, 11.6 KB
// gzipped over the page where the form needs 4.1. Measured 587.86 KB.
// 595 KB with the IR's table backend (lib/ir/table.mjs) and its interpreter
// (lib/kernels/table.mjs): ten form validators in a Vite application, 2.37 KB
// gzipped as plans against 5.35 as written modules. Measured 594.83 KB.
// 597 KB with the email, uri and uri-reference checks as regular expressions
// for the plans (lib/kernels/formats-small.mjs): email with uri 2166 to 641
// bytes gzipped in a bundle. Measured 596.84 KB.
// 598 KB with the README's browser section (Next.js, many forms, the same
// decision as the server) and the browser entry's development hint, which a
// production build drops. Measured 597.62 KB.
// 601 KB with plans over the wire (lib/kernels/plan.mjs, plan-rich.mjs,
// order.mjs, tablePlan): a page that receives its schema at run time loads
// 6.2 KB gzipped against 53.0 for the runtime. Measured 600.55 KB.
// 603 KB with ata-validator/openapi (operationSchemas), which a server and the
// build plugin's openapi option share. Measured 602.74 KB.
// 605 KB with a plan checked step by step when it is read, its version
// stamp, operation names from operationId and jsonSchemaDialect. Measured
// 604.45 KB.
// 607 KB with the interpreted engine's closed-object walk and its leaves
// checked in place (lib/plan-compiler.js): an order form with codes blocked
// 189 to 139 ns. Measured 606.14 KB.
// 611 KB with the IR module writer's verdict pass (lib/ir/emit.mjs,
// lib/ir/front.mjs): small checks written in at their call, for-in key loops
// with a module-local own test, defaults as literals, one loop for
// patternProperties beside additionalProperties: false, unread flags
// dropped. Against the compiled modules on SchemaStore, warmed, the verdict
// geometric mean went from 1.018 to 0.878 and the schemas slower by a fifth
// from 129 to 47. Measured 609.57 KB.
// 617 KB with the six plan handlers and the shared default pass a plan
// names (lib/kernels/table.mjs, lib/ir/table.mjs, lib/kernels/plan.mjs),
// the ata-validator/ir declarations (lib/ir/index.d.ts) and the front end's
// refusal of propertyDependencies. Measured 616.07 KB.
// 620 KB with the README paragraphs on the plugin's zod and from options,
// fastify-ata's stream and plans and the six-dialect figures, and the
// runtime's `defaults` part: a compact or schema module with a default asks
// the runtime it imports for the pass (lib/schema-runtime-entry.js,
// lib/error-runtime.js) instead of carrying it as generated code, which was
// 108 KB in pantsbuild's module; forty SchemaStore schemas in schema mode
// bundle to 119.2 KB gzipped from 133.0, in auto mode to 231.5 from 246.4.
// Measured 619.04 KB.
// 621 KB with LeafPlan (lib/interpreter-core.js): nodes without rare
// keywords keep those fields on one prototype, 9.98 to 8.00 KB a compiled
// tool-like schema. Measured 620.37 KB.
// 622 KB with the closure tree's tagged-union table and deferred cycle
// guard (lib/plan-compiler.js) and their tests' notes. Measured 621.17 KB.
// 623 KB with the one-pass normalization scan (lib/schema-scan.js), a new
// schema's first check 12.2 to 10.7 us. Measured 622.22 KB.
// 624 KB with the set-free normalization scan, first check 9.49 to 8.86 us.
// Measured 623.25 KB.
// 625 KB with the fixed unevaluatedProperties model in the code generator
// (staticUnevalPatterns): an OpenAPI 3.1 document validated 7.1 to 4.2 ms.
// Measured 624.85 KB.
// 635 KB with IDNA2008 for `hostname` and `idn-hostname` (lib/idna-impl.js,
// lib/idna.browser.js, idna.js, and the copy the format kernels carry in
// lib/kernels/formats.mjs). Measured 634.9 KB.
// 636 KB with the branch-verdict constants declared in error functions and
// property defaults kept off arrays, both found by the all-paths
// differential. Measured 635.4 KB.
// 637 KB with the corrected Infer (mutable data, open tuples, nullable,
// nested references) and its documentation. Measured 636.2 KB.
// 639 KB with the key loop on any node of 32 or more optional properties,
// taken once the documents show more than four shapes (cypress' configuration
// 2.41 ms to 0.10 ms a pass of 981 documents). Measured 638.2 KB.
assert.ok(manifest.size < 639 * 1024, `tarball ${manifest.size} bytes exceeds ceiling (adjust only with a reviewed reason)`);

console.log(`ok: core tarball is pure JS (${files.length} files, ${manifest.size} bytes packed)`);
