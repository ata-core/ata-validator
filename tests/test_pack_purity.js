'use strict';

// The core tarball must be pure JS: no binaries, no vendored C++ deps, no
// build system, no install script. Runs `npm pack --dry-run --json` and
// inspects the manifest. Sibling of the browser-imports guard.

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const manifest = JSON.parse(out)[0];
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

// Size ceiling: 300 KB hard cap; adjust only with a reviewed reason.
assert.ok(manifest.size < 300 * 1024, `tarball ${manifest.size} bytes exceeds ceiling (adjust only with a reviewed reason)`);

console.log(`ok: core tarball is pure JS (${files.length} files, ${manifest.size} bytes packed)`);
