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
const { TSC_JS: TSC_BIN } = require('./_tsc');

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

// Checks on the generator's text that need no compiler.
function directChecks() {
  const assert = require('assert');
  // The JSDoc block carries pattern, format, default and example values from
  // the schema. A `*/` inside one of them closed the comment and the rest of
  // the value was read as a declaration.
  const evil = '*/ declare const __ataDoc: 1; /*';
  const out = toTypeScript({ type: 'object', properties: { a: { type: 'string', description: evil, pattern: evil, format: evil, default: evil, examples: [evil] } } }, { name: 'Doc' });
  assert.ok(!out.includes('__ataDoc: 1; /*') || !/\*\/\s*declare const __ataDoc/.test(out), 'a value cannot close the comment');
  for (const block of out.match(/\/\*\*[\s\S]*?\*\//g) || []) assert.ok(!block.slice(3, -2).includes('*/'), 'no */ inside a comment block: ' + block);

  // Each property is rendered once. The index signature repeats a nested
  // object's type, so a chain of objects with additionalProperties doubled
  // per level (2^levels characters, 2^levels renders): 22 levels did not
  // finish. The index signature is `unknown` where a property is an object
  // literal, and the output grows with the schema.
  const nest = (d) => { let s = { type: 'string' }; for (let i = 0; i < d; i++) s = { type: 'object', properties: { a: s }, additionalProperties: { type: 'string' } }; return s; };
  const t0 = Date.now();
  const d8 = toTypeScript(nest(8)).length;
  const d24 = toTypeScript(nest(24)).length;
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `nested objects took ${ms} ms`);
  assert.ok(d24 < d8 * 4, `output for 24 levels is ${d24} chars against ${d8} for 8`);
  // A scalar property keeps the typed index signature.
  const flat = toTypeScript({ type: 'object', properties: { a: { type: 'number' } }, additionalProperties: { type: 'string' } });
  assert.ok(flat.includes('[key: string]: string | number | undefined;'), flat);
  process.stdout.write('direct checks: comment escaping, nested output size\n');
}

function main() {
  directChecks();
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
