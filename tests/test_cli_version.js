'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const bin = path.join(__dirname, '..', 'bin', 'ata.js');
const version = require('../package.json').version;

function run(args) {
  return spawnSync('node', [bin, ...args], { encoding: 'utf8' });
}

// --version prints the package version and exits 0
{
  const r = run(['--version']);
  assert.strictEqual(r.status, 0, `--version exited ${r.status}, stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes(version), `--version stdout missing "${version}": ${JSON.stringify(r.stdout)}`);
  assert.strictEqual(r.stderr, '', `--version wrote to stderr: ${r.stderr}`);
}

// -V is an alias for --version
{
  const r = run(['-V']);
  assert.strictEqual(r.status, 0, `-V exited ${r.status}, stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes(version), `-V stdout missing "${version}": ${JSON.stringify(r.stdout)}`);
}

// the bare "version" subcommand works too
{
  const r = run(['version']);
  assert.strictEqual(r.status, 0, `version exited ${r.status}, stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes(version), `version stdout missing "${version}": ${JSON.stringify(r.stdout)}`);
}

console.log('ok: CLI --version reports the package version');
