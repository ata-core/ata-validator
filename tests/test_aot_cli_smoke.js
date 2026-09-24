'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ata.js');
const FIXTURES = path.join(__dirname, 'fixtures/aot-build');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ata-aot-smoke-')); }

let passed = 0, failed = 0;
function ok(name) { console.log(`  PASS  ${name}`); passed++; }
function ko(name, msg) { console.log(`  FAIL  ${name}: ${msg}`); failed++; }

console.log('\nata aot CLI smoke test\n');

// 1. Build a small project, end-to-end, with all relevant flags.
{
  const dir = tmpDir();
  const outDir = path.join(dir, 'out');
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'a.schema.json'));
  fs.copyFileSync(path.join(FIXTURES, 'complex.schema.json'), path.join(dir, 'b.schema.json'));
  const r = spawnSync('node', [
    CLI, 'build', path.join(dir, '*.schema.json'),
    '--out-dir', outDir,
    // A value the fixture fits under, so the build exercises the flag rather
    // than tripping it. Not a size budget: those live in
    // benchmark/bench_aot_size.mjs, which gates growth per shape, and in
    // tests/test_pack_purity.js for the package itself. Raised from 8192 when
    // the one-pass email check put the complex fixture 6 bytes over.
    '--max-size', '10240',
  ], { encoding: 'utf8' });
  if (r.status !== 0) ko('smoke build', `exit ${r.status}: ${r.stderr}`);
  else if (!fs.existsSync(path.join(outDir, 'a.compiled.mjs'))) ko('smoke build', 'a.compiled.mjs missing');
  else if (!fs.existsSync(path.join(outDir, 'b.compiled.mjs'))) ko('smoke build', 'b.compiled.mjs missing');
  else if (!fs.existsSync(path.join(outDir, 'a.compiled.d.mts'))) ko('smoke build', 'a.compiled.d.mts missing');
  else ok('smoke build');
}

// 2. Re-run with --check on the same outputs (with cache file): should pass.
{
  const dir = tmpDir();
  const outDir = path.join(dir, 'out');
  const cacheFile = path.join(dir, '.cache.json');
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'a.schema.json'));
  // First build with cache file (use the programmatic API rather than CLI to keep cache wiring
  // concentrated until --cache-file CLI flag lands in a follow-up task).
  const buildPkg = require('../lib/aot-build');
  buildPkg.build({ globs: [path.join(dir, '*.schema.json')], outDir, cacheFile }).then((r1) => {
    if (r1.compiled.length !== 1) ko('smoke check', `unexpected first run: ${JSON.stringify(r1)}`);
    else {
      buildPkg.build({ globs: [path.join(dir, '*.schema.json')], outDir, cacheFile, check: true }).then((r2) => {
        if (r2.staleCount !== 0) ko('smoke check', `stale=${r2.staleCount}`);
        else ok('smoke check');
        finish();
      });
    }
  });
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
