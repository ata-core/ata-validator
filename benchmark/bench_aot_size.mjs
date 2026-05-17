import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const baselinePath = join(__dirname, 'baselines/aot-size.json');

const fixtures = [
  { name: 'user-10field', file: 'tests/fixtures/error-dx/user.schema.json' },
  { name: 'user-50field', file: 'tests/fixtures/error-dx/large.schema.json' },
];

const results = {};
for (const fx of fixtures) {
  const dir = mkdtempSync(join(tmpdir(), 'ata-size-'));
  try {
    for (const mode of ['source', 'nosource']) {
      const flag = mode === 'source' ? '--source' : '--no-source';
      const out = join(dir, `${fx.name}-${mode}.mjs`);
      execSync(
        `node ${join(root, 'bin/ata.js')} compile ${join(root, fx.file)} -o ${out} ${flag} --no-types`,
        { stdio: 'pipe' },
      );
      const raw = readFileSync(out);
      const gz = gzipSync(raw).length;
      results[`${fx.name}.${mode}.gz`] = gz;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify(results, null, 2));

if (process.argv.includes('--write-baseline')) {
  writeFileSync(baselinePath, JSON.stringify(results, null, 2) + '\n');
  console.log(`wrote baseline to ${baselinePath}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('No baseline. Run with --write-baseline to create one.');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

// Gates derived from baseline using the policy in the M5 plan:
//   - per-key absolute gate = baseline * 1.5 (50% headroom before re-baselining)
//   - source-mapped variants get no extra ceiling (dev-mode artifact, size matters less)
//   - nosource variants get a soft-cap blend with baseline*1.5; the soft cap
//     never undercuts the baseline (would make any successful run fail).
const SOFT_CAP_NOSOURCE_10 = 1500;
const SOFT_CAP_NOSOURCE_50 = 2000;
const GATES = {
  'user-10field.source.gz':   Math.round((baseline['user-10field.source.gz']   ?? 0) * 1.5),
  'user-10field.nosource.gz': Math.max(
    Math.min(Math.round((baseline['user-10field.nosource.gz'] ?? 0) * 1.5), SOFT_CAP_NOSOURCE_10),
    Math.round((baseline['user-10field.nosource.gz'] ?? 0) * 1.25),
  ),
  'user-50field.source.gz':   Math.round((baseline['user-50field.source.gz']   ?? 0) * 1.5),
  'user-50field.nosource.gz': Math.max(
    Math.min(Math.round((baseline['user-50field.nosource.gz'] ?? 0) * 1.5), SOFT_CAP_NOSOURCE_50),
    Math.round((baseline['user-50field.nosource.gz'] ?? 0) * 1.25),
  ),
};

let failed = false;
for (const k of Object.keys(results)) {
  const cur = results[k];
  const base = baseline[k] || cur;
  const growth = (cur - base) / base;
  const gate = GATES[k];
  console.log(`${k}: ${cur} bytes (baseline ${base}, growth ${(growth * 100).toFixed(1)}%, gate ${gate || 'n/a'})`);
  if (gate && cur > gate) { console.error(`  FAIL: ${k} exceeds absolute gate ${gate}`); failed = true; }
  if (growth > 0.25) { console.error(`  FAIL: ${k} grew >25% over baseline`); failed = true; }
}

if (failed) process.exit(1);
console.log('ok: AOT size budget passed');
