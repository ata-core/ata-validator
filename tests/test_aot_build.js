'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../lib/aot-build');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ata-aot-build-'));
}

console.log('\nata aot build tests\n');

(async () => {
  for (const t of [
    ['build: emits per-file modules from glob', async () => {
      const dir = tmpDir();
      const src = path.join(dir, 'user.schema.json');
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), src);
      const report = await build({ globs: [path.join(dir, '*.schema.json')] });
      assert(report.compiled.length === 1, `expected 1 compiled, got ${report.compiled.length}`);
      const out = path.join(dir, 'user.compiled.mjs');
      assert(fs.existsSync(out), `expected ${out} to exist`);
      const src2 = fs.readFileSync(out, 'utf8');
      assert(src2.includes('export'), 'output should contain ESM export');
    }],

    ['build: emits one module per input across a glob', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'a.schema.json'));
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/complex.schema.json'), path.join(dir, 'b.schema.json'));
      const report = await build({ globs: [path.join(dir, '*.schema.json')] });
      assert(report.compiled.length === 2, `expected 2 compiled, got ${report.compiled.length}`);
      assert(fs.existsSync(path.join(dir, 'a.compiled.mjs')), 'a.compiled.mjs missing');
      assert(fs.existsSync(path.join(dir, 'b.compiled.mjs')), 'b.compiled.mjs missing');
    }],

    ['build: complex schema (format + patternProperties) compiles to a working validator', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/complex.schema.json'), path.join(dir, 'order.schema.json'));
      const report = await build({ globs: [path.join(dir, '*.schema.json')] });
      assert(report.compiled.length === 1, `expected 1 compiled, got ${report.compiled.length}`);
      const out = path.join(dir, 'order.compiled.mjs');
      const mod = await import('file://' + out);
      assert(typeof mod.validate === 'function', 'validate export missing');
      const validDoc = { id: 1, name: 'a', email: 'a@b.com', tags: ['t'] };
      assert(mod.validate(validDoc).valid === true, 'valid doc should pass');
      assert(mod.validate({ id: 0 }).valid === false, 'invalid doc should fail');
    }],

    ['build: respects outDir', async () => {
      const dir = tmpDir();
      const outDir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'x.schema.json'));
      await build({ globs: [path.join(dir, '*.schema.json')], outDir });
      assert(fs.existsSync(path.join(outDir, 'x.compiled.mjs')), 'output not in outDir');
      assert(!fs.existsSync(path.join(dir, 'x.compiled.mjs')), 'output should NOT be alongside source');
    }],

    ['build: respects suffix', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'y.schema.json'));
      await build({ globs: [path.join(dir, '*.schema.json')], suffix: '.gen' });
      assert(fs.existsSync(path.join(dir, 'y.gen.mjs')), 'expected suffix to be .gen');
    }],

    ['build: skips unchanged inputs on second run (cache hit)', async () => {
      const dir = tmpDir();
      const cacheFile = path.join(dir, '.cache.json');
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'c.schema.json'));
      const r1 = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile });
      assert(r1.compiled.length === 1 && r1.cached.length === 0, `r1 compiled=${r1.compiled.length} cached=${r1.cached.length}`);
      const r2 = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile });
      assert(r2.compiled.length === 0 && r2.cached.length === 1, `r2 compiled=${r2.compiled.length} cached=${r2.cached.length}`);
    }],

    ['build: a cached module built without source frames is rebuilt when they are asked for', async () => {
      // The cache entry did not record `source`, so a production build
      // (no frames) followed by a development one kept the module without
      // frames and reported it as up to date. With inline errors the other
      // recorded settings do not change between the two.
      const dir = tmpDir();
      const cacheFile = path.join(dir, '.cache.json');
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 's.schema.json'));
      const out = path.join(dir, 's.compiled.mjs');
      const r1 = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile, errors: 'inline', source: false });
      assert(r1.compiled.length === 1, `r1 compiled=${r1.compiled.length}`);
      assert(!fs.readFileSync(out, 'utf8').includes('schemaSource'), 'no frames without source');
      const r2 = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile, errors: 'inline', source: true });
      assert(r2.compiled.length === 1 && r2.cached.length === 0, `r2 compiled=${r2.compiled.length} cached=${r2.cached.length}`);
      assert(fs.readFileSync(out, 'utf8').includes('schemaSource'), 'frames after asking for them');
      const r3 = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile, errors: 'inline', source: true });
      assert(r3.compiled.length === 0 && r3.cached.length === 1, `r3 compiled=${r3.compiled.length} cached=${r3.cached.length}`);
      const r4 = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile, errors: 'inline', source: false, check: true });
      assert(r4.staleCount === 1, `check with the other source setting: staleCount=${r4.staleCount}`);
    }],

    ['build: the shared runtime goes to / when the outputs share nothing else', async () => {
      // The walk up to a common directory compared against dir + '/', which
      // for '/' is '//', so it never matched and the loop did not end.
      const { _runtimePathFor } = require('../lib/aot-build');
      const t0 = Date.now();
      assert(_runtimePathFor(['/a/x.mjs', '/b/y.mjs'], {}, 'esm') === path.resolve('/ata-errors.mjs'), 'different roots');
      assert(_runtimePathFor(['/x.mjs', '/a/y.mjs'], {}, 'cjs') === path.resolve('/ata-errors.cjs'), 'one at the root');
      assert(_runtimePathFor(['/a/x.mjs', '/a/b/y.mjs'], {}, 'esm') === path.resolve('/a/ata-errors.mjs'), 'common parent');
      assert(_runtimePathFor(['/ab/x.mjs', '/a/y.mjs'], {}, 'esm') === path.resolve('/ata-errors.mjs'), 'a name prefix is not a parent');
      assert(Date.now() - t0 < 1000, 'ends');
    }],

    ['watch: writing its own cache file does not start another build', async () => {
      // The cache file is JSON and usually sits beside the schemas, so each
      // build's cache write woke the watcher and the builds never stopped.
      const { watch } = require('../lib/aot-build');
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'w.schema.json'));
      let builds = 0;
      const w = await watch({ globs: [path.join(dir, '*.schema.json')], cacheFile: path.join(dir, '.ata-cache.json') }, () => { builds++; });
      try {
        await new Promise((r) => setTimeout(r, 300));
        const before = builds;
        const altered = JSON.parse(fs.readFileSync(path.join(dir, 'w.schema.json'), 'utf8'));
        altered.properties.id.minimum = 5;
        fs.writeFileSync(path.join(dir, 'w.schema.json'), JSON.stringify(altered));
        await new Promise((r) => setTimeout(r, 1500));
        const after = builds - before;
        assert(after >= 1 && after <= 2, `builds after one edit: ${after}`);
      } finally {
        w.close();
      }
    }],

    ['build: re-compiles when input content changes', async () => {
      const dir = tmpDir();
      const cacheFile = path.join(dir, '.cache.json');
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'd.schema.json'));
      await build({ globs: [path.join(dir, '*.schema.json')], cacheFile });
      // Modify input
      const altered = JSON.parse(fs.readFileSync(path.join(dir, 'd.schema.json'), 'utf8'));
      altered.properties.id.minimum = 5;
      fs.writeFileSync(path.join(dir, 'd.schema.json'), JSON.stringify(altered));
      const r2 = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile });
      assert(r2.compiled.length === 1 && r2.cached.length === 0, `r2 compiled=${r2.compiled.length} cached=${r2.cached.length}`);
    }],

    ['build: --check returns staleCount > 0 when output is missing', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'e.schema.json'));
      const r = await build({ globs: [path.join(dir, '*.schema.json')], check: true });
      assert(r.staleCount === 1, `expected 1 stale, got ${r.staleCount}`);
      assert(r.compiled.length === 0, `--check should not write outputs (got ${r.compiled.length})`);
    }],

    ['build: --check returns staleCount === 0 when up to date', async () => {
      const dir = tmpDir();
      const cacheFile = path.join(dir, '.cache.json');
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'f.schema.json'));
      await build({ globs: [path.join(dir, '*.schema.json')], cacheFile });
      const r = await build({ globs: [path.join(dir, '*.schema.json')], cacheFile, check: true });
      assert(r.staleCount === 0, `expected 0 stale, got ${r.staleCount}`);
    }],

    ['build: --max-size fails when output exceeds budget', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/complex.schema.json'), path.join(dir, 'big.schema.json'));
      const r = await build({ globs: [path.join(dir, '*.schema.json')], maxSize: 100 });
      assert(r.failed.length === 1, `expected 1 failed (over budget), got ${r.failed.length}`);
      assert(/exceeds.*max/i.test(r.failed[0].error), `expected size-budget error, got: ${r.failed[0].error}`);
    }],

    ['build: --max-size passes when output fits', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'small.schema.json'));
      const r = await build({ globs: [path.join(dir, '*.schema.json')], maxSize: 1_000_000 });
      assert(r.failed.length === 0, `expected 0 failed, got ${r.failed.length}`);
      assert(r.compiled.length === 1, `expected 1 compiled, got ${r.compiled.length}`);
    }],

    ['build: --strict promotes skipped to failed', async () => {
      const dir = tmpDir();
      // A schema using a runtime-only feature: dynamicRef. toStandaloneModule should return null.
      const incompatible = {
        $id: 'https://example.com/dyn',
        $defs: { node: { $dynamicAnchor: 'node', type: 'object' } },
        $dynamicRef: '#node',
      };
      fs.writeFileSync(path.join(dir, 'dyn.schema.json'), JSON.stringify(incompatible));
      const lax = await build({ globs: [path.join(dir, '*.schema.json')] });
      // The schema MAY succeed or be skipped depending on engine support; if it succeeds, this test is
      // a no-op for the strict assertion. We only assert strict promotes skipped → failed when skipped.
      if (lax.skipped.length === 1) {
        const r = await build({ globs: [path.join(dir, '*.schema.json')], strict: true });
        assert(r.failed.length === 1 && r.skipped.length === 0, `strict mode: expected failed=1 skipped=0, got failed=${r.failed.length} skipped=${r.skipped.length}`);
      }
    }],

    ['build: compiles a YAML schema when yaml package is available', async () => {
      let yamlAvailable = false;
      try { require('yaml'); yamlAvailable = true; } catch {}
      if (!yamlAvailable) {
        console.log('  SKIP  build: YAML test (yaml package not installed)');
        return;
      }
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.yaml'), path.join(dir, 'y.schema.yaml'));
      const r = await build({ globs: [path.join(dir, '*.schema.yaml')] });
      assert(r.compiled.length === 1, `expected 1 compiled, got ${r.compiled.length}; failed: ${JSON.stringify(r.failed)}`);
      assert(fs.existsSync(path.join(dir, 'y.compiled.mjs')), 'output missing');
    }],

    ['build: clear error when YAML schema seen but yaml package missing', async () => {
      let yamlAvailable = false;
      try { require('yaml'); yamlAvailable = true; } catch {}
      if (yamlAvailable) {
        console.log('  SKIP  build: yaml-missing test (yaml package IS installed)');
        return;
      }
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.yaml'), path.join(dir, 'y.schema.yaml'));
      const r = await build({ globs: [path.join(dir, '*.schema.yaml')] });
      assert(r.failed.length === 1, `expected 1 failed, got ${r.failed.length}`);
      assert(/install.*yaml/i.test(r.failed[0].error), `expected 'install yaml' in error, got: ${r.failed[0].error}`);
    }],

    ['subpath: require("ata-validator/build") works after pack', async () => {
      // Sanity check the export wiring locally by requiring the file by absolute path
      // (full publish/install flow is verified by the npm test job).
      const buildPkg = require(path.join(__dirname, '..', 'build.js'));
      assert(typeof buildPkg.build === 'function', 'build.js should export `build`');
      const buildEsm = await import('file://' + path.join(__dirname, '..', 'build.mjs'));
      assert(typeof buildEsm.build === 'function', 'build.mjs should export `build`');
    }],

    ['build: emits .d.mts alongside .compiled.mjs by default', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 't.schema.json'));
      await build({ globs: [path.join(dir, '*.schema.json')] });
      assert(fs.existsSync(path.join(dir, 't.compiled.mjs')), 'expected .compiled.mjs');
      assert(fs.existsSync(path.join(dir, 't.compiled.d.mts')), 'expected .d.mts sibling');
      const dts = fs.readFileSync(path.join(dir, 't.compiled.d.mts'), 'utf8');
      assert(/export .*validate/.test(dts), `expected validate export in dts: ${dts}`);
    }],

    ['build: --no-types skips dts emission', async () => {
      const dir = tmpDir();
      fs.copyFileSync(path.join(__dirname, 'fixtures/aot-build/simple.schema.json'), path.join(dir, 'u.schema.json'));
      await build({ globs: [path.join(dir, '*.schema.json')], types: false });
      assert(fs.existsSync(path.join(dir, 'u.compiled.mjs')), 'expected .compiled.mjs');
      assert(!fs.existsSync(path.join(dir, 'u.compiled.d.mts')), 'expected NO .d.mts');
    }],
  ]) {
    const [name, fn] = t;
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
