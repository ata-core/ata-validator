#!/usr/bin/env node
'use strict';

// Test runner for the TypeScript type generator.
//
// Each fixture lives in tests/ts_fixtures/<category>/<name>/ and ships:
//   - schema.json   : the input JSON Schema
//   - use.ts        : a TypeScript file that imports the generated
//                     validator and exercises the emitted types.
//                     It must compile cleanly unless marked negative.
//   - meta.json     : optional {"expectFailure": true} for negative tests.
//
// For each fixture the runner:
//   1. Runs ata's generator to produce validator.mjs and validator.d.mts
//      inside the fixture directory.
//   2. Invokes tsc on use.ts with the ata-level tsconfig.
//   3. Asserts the exit code matches expectFailure (default: must succeed).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { Validator } = require('..');
const { toTypeScript } = require('../lib/ts-gen');
const aot = require('../lib/aot');

const FIXTURES_DIR = path.join(__dirname, 'ts_fixtures');
const TSC_BIN = require.resolve('typescript/lib/tsc.js');

function toTypeName(name) {
  const cleaned = String(name).replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function discoverFixtures() {
  const fixtures = [];
  for (const category of fs.readdirSync(FIXTURES_DIR)) {
    const catDir = path.join(FIXTURES_DIR, category);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const name of fs.readdirSync(catDir)) {
      const dir = path.join(catDir, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const schemaPath = path.join(dir, 'schema.json');
      const usePath = path.join(dir, 'use.ts');
      if (!fs.existsSync(schemaPath) || !fs.existsSync(usePath)) continue;
      const metaPath = path.join(dir, 'meta.json');
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
      fixtures.push({ category, name, dir, schemaPath, usePath, meta });
    }
  }
  return fixtures.sort((a, b) => (a.category + '/' + a.name).localeCompare(b.category + '/' + b.name));
}

function generate(fixture) {
  const schema = JSON.parse(fs.readFileSync(fixture.schemaPath, 'utf8'));
  const v = new Validator(schema);
  const src = aot.toStandaloneModule(v, { format: 'esm' });
  if (!src) throw new Error(`schema in ${fixture.dir} produced no standalone module`);
  const typeName = toTypeName(fixture.meta.typeName || fixture.name);
  const dts = toTypeScript(schema, { name: typeName });
  fs.writeFileSync(path.join(fixture.dir, 'validator.mjs'), src);
  fs.writeFileSync(path.join(fixture.dir, 'validator.d.mts'), dts);
}

function compile(fixture) {
  const result = spawnSync(process.execPath, [TSC_BIN,
    '--target', 'ES2022',
    '--module', 'ESNext',
    '--moduleResolution', 'bundler',
    '--strict',
    '--noEmit',
    '--lib', 'ES2022',
    path.join(fixture.dir, 'use.ts'),
  ], { encoding: 'utf8' });
  return { code: result.status, out: (result.stdout || '') + (result.stderr || '') };
}

function main() {
  const fixtures = discoverFixtures();
  if (fixtures.length === 0) {
    process.stdout.write('no fixtures found under tests/ts_fixtures\n');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  process.stdout.write(`\nTypeScript type generator: ${fixtures.length} fixtures\n`);
  process.stdout.write('='.repeat(60) + '\n');

  for (const f of fixtures) {
    let status = 'PASS';
    let detail = '';
    try {
      generate(f);
      const { code, out } = compile(f);
      const expectFailure = !!f.meta.expectFailure;
      if (expectFailure && code === 0) {
        status = 'FAIL';
        detail = 'expected tsc to reject use.ts but it compiled cleanly';
      } else if (!expectFailure && code !== 0) {
        status = 'FAIL';
        detail = out.trim().split('\n').slice(0, 8).join('\n        ');
      }
    } catch (err) {
      status = 'FAIL';
      detail = `threw during generation: ${err.message}`;
    }

    const label = `${f.category}/${f.name}`.padEnd(45);
    if (status === 'PASS') {
      process.stdout.write(`  PASS  ${label}\n`);
      passed++;
    } else {
      process.stdout.write(`  FAIL  ${label}\n        ${detail}\n`);
      failed++;
      failures.push({ f, detail });
    }
  }

  process.stdout.write('='.repeat(60) + '\n');
  process.stdout.write(`${passed} passed, ${failed} failed (${fixtures.length} total)\n`);

  if (failed > 0) process.exit(1);
}

main();
