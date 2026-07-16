'use strict';

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-natpkg-'));
const fakeBinary = path.join(tmp, 'fake.node');
fs.writeFileSync(fakeBinary, Buffer.from('not a real binary'));

execFileSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'make-native-package.js'),
  '--binary', fakeBinary, '--target', 'linux-arm64-musl', '--out', tmp,
]);

const dir = path.join(tmp, 'native-linux-arm64-musl');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
assert.strictEqual(pkg.name, '@ata-validator/native-linux-arm64-musl');
assert.strictEqual(pkg.version, require(path.join(__dirname, '..', 'package.json')).version);
assert.deepStrictEqual(pkg.os, ['linux']);
assert.deepStrictEqual(pkg.cpu, ['arm64']);
assert.deepStrictEqual(pkg.libc, ['musl']);
assert.strictEqual(pkg.main, 'ata.node');
assert.ok(fs.existsSync(path.join(dir, 'ata.node')), 'binary copied as ata.node');

// darwin target must not emit a libc field
execFileSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'make-native-package.js'),
  '--binary', fakeBinary, '--target', 'darwin-arm64', '--out', tmp,
]);
const dpkg = JSON.parse(fs.readFileSync(path.join(tmp, 'native-darwin-arm64', 'package.json'), 'utf8'));
assert.strictEqual(dpkg.libc, undefined);
assert.deepStrictEqual(dpkg.os, ['darwin']);

// unknown target must fail loudly
assert.throws(() => execFileSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'make-native-package.js'),
  '--binary', fakeBinary, '--target', 'plan9-mips', '--out', tmp,
], { stdio: 'pipe' }));

console.log('ok: native package assembler');
