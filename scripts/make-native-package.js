'use strict';

// Assemble one @ata-validator/native-* package directory from a built
// binary. Called by .github/workflows/prebuild.yml per platform; the CLI is
// the contract, keep it stable.
//
//   node scripts/make-native-package.js --binary <path> --target <t> --out <dir>

const fs = require('fs');
const path = require('path');

const TARGETS = {
  'darwin-arm64': { os: 'darwin', cpu: 'arm64' },
  'linux-x64-gnu': { os: 'linux', cpu: 'x64', libc: 'glibc' },
  'linux-arm64-gnu': { os: 'linux', cpu: 'arm64', libc: 'glibc' },
  'linux-x64-musl': { os: 'linux', cpu: 'x64', libc: 'musl' },
  'linux-arm64-musl': { os: 'linux', cpu: 'arm64', libc: 'musl' },
  'win32-x64': { os: 'win32', cpu: 'x64' },
};

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
  return process.argv[i + 1];
}

const binary = arg('--binary');
const target = arg('--target');
const out = arg('--out');

const spec = TARGETS[target];
if (!spec) throw new Error(`unknown target "${target}" (expected one of: ${Object.keys(TARGETS).join(', ')})`);
if (!fs.existsSync(binary)) throw new Error(`binary not found: ${binary}`);

const version = require(path.join(__dirname, '..', 'package.json')).version;
const dir = path.join(out, `native-${target}`);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(binary, path.join(dir, 'ata.node'));

const pkg = {
  name: `@ata-validator/native-${target}`,
  version,
  description: `ata-validator native engine for ${target}. Installed automatically as an optional dependency; do not depend on this package directly.`,
  main: 'ata.node',
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/ata-core/ata-validator.git' },
  os: [spec.os],
  cpu: [spec.cpu],
};
if (spec.libc) pkg.libc = [spec.libc];

fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(`assembled ${pkg.name}@${version} at ${dir}`);
