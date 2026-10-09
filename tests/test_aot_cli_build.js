'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ata.js');
const FIXTURES = path.join(__dirname, 'fixtures/aot-build');

const tests = [];
let passed = 0, failed = 0;
function test(name, fn) {
  tests.push([name, fn]);
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ata-aot-cli-')); }

console.log('\nata aot CLI build tests\n');

test('cli: build emits per-file modules from glob arg', () => {
  const dir = tmpDir();
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'a.schema.json'));
  fs.copyFileSync(path.join(FIXTURES, 'complex.schema.json'), path.join(dir, 'b.schema.json'));
  const res = spawnSync('node', [CLI, 'build', path.join(dir, '*.schema.json')], { encoding: 'utf8' });
  assert(res.status === 0, `cli exit ${res.status}: ${res.stderr}`);
  assert(fs.existsSync(path.join(dir, 'a.compiled.mjs')), 'a.compiled.mjs missing');
  assert(fs.existsSync(path.join(dir, 'b.compiled.mjs')), 'b.compiled.mjs missing');
});

test('cli: build prints a summary line per compiled file', () => {
  const dir = tmpDir();
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'x.schema.json'));
  const res = spawnSync('node', [CLI, 'build', path.join(dir, '*.schema.json')], { encoding: 'utf8' });
  assert(res.status === 0, `cli exit ${res.status}: ${res.stderr}`);
  assert(/x\.schema\.json/.test(res.stdout), `stdout missing input mention: ${res.stdout}`);
  assert(/x\.compiled\.mjs/.test(res.stdout), `stdout missing output mention: ${res.stdout}`);
});

test('cli: build --out-dir routes outputs', () => {
  const dir = tmpDir();
  const outDir = tmpDir();
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'q.schema.json'));
  const res = spawnSync('node', [CLI, 'build', path.join(dir, '*.schema.json'), '--out-dir', outDir], { encoding: 'utf8' });
  assert(res.status === 0, `cli exit ${res.status}: ${res.stderr}`);
  assert(fs.existsSync(path.join(outDir, 'q.compiled.mjs')), 'output not in --out-dir');
});

test('cli: build --check exits 1 when stale', () => {
  const dir = tmpDir();
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'k.schema.json'));
  const res = spawnSync('node', [CLI, 'build', path.join(dir, '*.schema.json'), '--check'], { encoding: 'utf8' });
  assert(res.status === 1, `expected exit 1 (stale), got ${res.status}`);
  assert(/stale/.test(res.stdout), `expected 'stale' in stdout: ${res.stdout}`);
});

test('cli: build --watch re-emits on change then exits on SIGINT', async () => {
  const dir = tmpDir();
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'w.schema.json'));
  const child = require('child_process').spawn('node', [CLI, 'build', path.join(dir, '*.schema.json'), '--watch'], { encoding: 'utf8' });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });

  // Wait for the initial build line: polled, not a fixed delay, because the
  // CLI's start on a loaded CI runner has taken longer than half a second.
  const until = async (ok, ms) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
  assert(await until(() => /w\.schema\.json/.test(stdout), 15000), `initial build did not emit; stdout=${stdout}`);

  // Modify the schema, after a pause longer than the watcher's modification
  // time granularity: a rewrite inside the same second as the first build
  // went unseen on Linux in CI, and the re-emit never came.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const altered = JSON.parse(fs.readFileSync(path.join(dir, 'w.schema.json'), 'utf8'));
  altered.properties.id.minimum = 7;
  fs.writeFileSync(path.join(dir, 'w.schema.json'), JSON.stringify(altered));
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(dir, 'w.schema.json'), later, later);

  // Wait for the re-emit the same way.
  const reemits = () => (stdout.match(/w\.schema\.json/g) || []).length;
  assert(await until(() => reemits() >= 2, 15000), `expected re-emit, stdout occurrences=${reemits()}; stdout=${stdout}`);

  child.kill('SIGINT');
  await new Promise((resolve) => child.on('exit', resolve));
});

test('cli: build --cache-file uses cache for second run', () => {
  const dir = tmpDir();
  const cacheFile = path.join(dir, '.cache.json');
  fs.copyFileSync(path.join(FIXTURES, 'simple.schema.json'), path.join(dir, 'cf.schema.json'));
  const r1 = spawnSync('node', [CLI, 'build', path.join(dir, '*.schema.json'), '--cache-file', cacheFile], { encoding: 'utf8' });
  assert(r1.status === 0, `r1 exit ${r1.status}: ${r1.stderr}`);
  assert(fs.existsSync(cacheFile), 'cache file should be created');
  const r2 = spawnSync('node', [CLI, 'build', path.join(dir, '*.schema.json'), '--cache-file', cacheFile], { encoding: 'utf8' });
  assert(r2.status === 0, `r2 exit ${r2.status}: ${r2.stderr}`);
  assert(/cached/.test(r2.stdout), `r2 stdout should mention cached: ${r2.stdout}`);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
