'use strict';

// The loader resolves: ATA_NO_NATIVE -> null; matching platform package;
// other libc variant on linux; repo dev build; null. Name computation is a
// pure function so the matrix is testable without any platform simulation.

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { nativePackageName } = require('../lib/native-load.js');

assert.strictEqual(nativePackageName('darwin', 'arm64', false), '@ata-validator/native-darwin-arm64');
assert.strictEqual(nativePackageName('win32', 'x64', false), '@ata-validator/native-win32-x64');
assert.strictEqual(nativePackageName('linux', 'x64', false), '@ata-validator/native-linux-x64-gnu');
assert.strictEqual(nativePackageName('linux', 'x64', true), '@ata-validator/native-linux-x64-musl');
assert.strictEqual(nativePackageName('linux', 'arm64', false), '@ata-validator/native-linux-arm64-gnu');
assert.strictEqual(nativePackageName('linux', 'arm64', true), '@ata-validator/native-linux-arm64-musl');
assert.strictEqual(nativePackageName('darwin', 'x64', false), '@ata-validator/native-darwin-x64');
assert.strictEqual(nativePackageName('freebsd', 'x64', false), null);
// A platform ata builds for, on an architecture it does not.
assert.strictEqual(nativePackageName('darwin', 'ia32', false), null);
assert.strictEqual(nativePackageName('win32', 'arm64', false), null);

// ATA_NO_NATIVE forces the pure-JS engine even where a dev build exists.
const child = spawnSync(process.execPath, ['-e', `
  const load = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'native-load.js'))});
  console.log(load() === null ? 'NULL_OK' : 'UNEXPECTED_NATIVE');
`], { env: { ...process.env, ATA_NO_NATIVE: '1' }, encoding: 'utf8' });
assert.ok(child.stdout.includes('NULL_OK'), `ATA_NO_NATIVE must force null (got: ${child.stdout} ${child.stderr})`);

// Version mismatch: a fake platform package whose binding reports a wrong
// version must be rejected with a warning and fall through to null/dev.
const mismatch = spawnSync(process.execPath, ['-e', `
  const Module = require('module');
  const orig = Module._load;
  const fakeName = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'native-load.js'))}).nativePackageName(process.platform, process.arch, false);
  Module._load = function (request, ...rest) {
    if (fakeName && request === fakeName) return { version: () => '0.0.1-fake' };
    // Path separator differs per platform; match both so Windows blocks too.
    if (/build[\\\\\\/]Release/.test(request)) throw new Error('no dev build in this test');
    return orig.call(this, request, ...rest);
  };
  const warnings = [];
  process.emitWarning = (msg) => warnings.push(String(msg));
  const load = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'native-load.js'))});
  const result = load();
  console.log('result:', result === null ? 'NULL_OK' : 'LOADED');
  console.log('warned:', warnings.some(w => w.includes('0.0.1-fake')) ? 'WARN_OK' : 'NO_WARN');
`], { encoding: 'utf8' });
assert.ok(mismatch.stdout.includes('NULL_OK'), `mismatched native must be ignored (got: ${mismatch.stdout} ${mismatch.stderr})`);
assert.ok(mismatch.stdout.includes('WARN_OK'), `mismatch must warn once (got: ${mismatch.stdout})`);

console.log('ok: native load order and name matrix');
