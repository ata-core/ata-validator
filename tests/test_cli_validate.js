'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const schemaPath = path.join(__dirname, 'fixtures/error-dx/user.schema.json');
const dataPath = path.join(os.tmpdir(), 'ata-cli-test-data.json');
fs.writeFileSync(dataPath, '{"name":"M","email":"nope","age":-3}');

const bin = path.join(__dirname, '..', 'bin', 'ata.js');

// JSON format
{
  let stderr = '';
  try {
    execSync(`node ${bin} validate ${schemaPath} ${dataPath} --format=json`, { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected non-zero exit');
  } catch (e) {
    stderr = e.stderr.toString();
    assert.strictEqual(e.status, 1);
  }
  const parsed = JSON.parse(stderr);
  assert.ok(parsed.errors.length >= 3, `expected >=3 errors, got ${parsed.errors.length}`);
  assert.ok(parsed.errors.some(x => x.code === 'ATA3001'), 'expected ATA3001 in errors');
}

// Pretty format
{
  let stderr = '';
  try {
    execSync(`node ${bin} validate ${schemaPath} ${dataPath} --pretty --color=never`, { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected non-zero exit');
  } catch (e) {
    stderr = e.stderr.toString();
    assert.strictEqual(e.status, 1);
  }
  assert.ok(stderr.includes('error[ATA'), `pretty output missing 'error[ATA': ${stderr}`);
  assert.ok(stderr.includes('schema violation'), `pretty output missing footer: ${stderr}`);
}

// Compact format
{
  let stderr = '';
  try {
    execSync(`node ${bin} validate ${schemaPath} ${dataPath} --compact --color=never`, { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected non-zero exit');
  } catch (e) {
    stderr = e.stderr.toString();
    assert.strictEqual(e.status, 1);
  }
  assert.ok(stderr.includes('error ATA'), `compact output missing 'error ATA': ${stderr}`);
  assert.ok(stderr.includes('Found'), `compact output missing 'Found': ${stderr}`);
}

// Valid input -> exit 0
fs.writeFileSync(dataPath, '{"name":"Mert","email":"mert@example.com","age":26}');
try {
  execSync(`node ${bin} validate ${schemaPath} ${dataPath}`, { stdio: 'ignore' });
} catch (e) {
  assert.fail(`expected exit 0 for valid input, got ${e.status}`);
}

fs.unlinkSync(dataPath);
console.log('ok: CLI validate subcommand');
