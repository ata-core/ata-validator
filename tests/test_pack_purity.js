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
assert.ok(manifest.size < 376 * 1024, `tarball ${manifest.size} bytes exceeds ceiling (adjust only with a reviewed reason)`);

console.log(`ok: core tarball is pure JS (${files.length} files, ${manifest.size} bytes packed)`);
