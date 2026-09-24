'use strict';

// An emitted module has to say which ata built it.
//
// Staleness of a generated module was detectable on one axis only: it exports
// `schemaHash`, and a build compares that against `schemaHash(currentSchema)`.
// That catches a changed schema and nothing else. Upgrade ata, forget to re-run
// the generate step, and the old module keeps being used: the hash still
// matches, so the file is considered current, and nothing anywhere says the
// generator moved. The first production consumer measuring 1.28.0 lost a
// measurement round to exactly this, and the emitted file gave them no clue,
// because it named no version.
//
// A standalone module imports nothing by design, so it cannot check itself
// against the installed ata at runtime. The only fix is to carry the fact:
// `ataVersion` for a build to compare, and the version in the banner for a
// person reading the file.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toStandaloneModule } = require('../build.js');
const { toTypeScript } = require('../lib/ts-gen');
const VERSION = require('../lib/version');

const SCHEMA = {
  type: 'object',
  required: ['port'],
  properties: { port: { type: 'integer', minimum: 1 }, host: { type: 'string' } },
};

function load (src, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-stale-'));
  const p = path.join(dir, 'mod.' + ext);
  fs.writeFileSync(p, src);
  const mod = require(p);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

// --- the module carries the version that built it ---------------------------
{
  const src = toStandaloneModule(SCHEMA, { format: 'cjs' });
  const mod = load(src, 'cjs');

  assert.strictEqual(mod.ataVersion, VERSION, 'the emitted module exports the version that built it');
  assert.strictEqual(mod.default.ataVersion, VERSION, 'the default export carries it too');
  assert.ok(!src.includes('require('), 'carrying the version must not cost the module its independence');

  console.log('ok: a CJS module exports ataVersion');
}

// --- the same for ESM -------------------------------------------------------
{
  const src = toStandaloneModule(SCHEMA, { format: 'esm' });
  assert.ok(
    /export\s*\{[^}]*\bataVersion\b/.test(src),
    'the ESM module names ataVersion in its export list',
  );
  assert.ok(
    new RegExp('const ataVersion = ' + JSON.stringify(VERSION).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(src),
    'and declares it with the building version',
  );

  console.log('ok: an ESM module exports ataVersion');
}

// --- a person reading the file sees the version ------------------------------
{
  const src = toStandaloneModule(SCHEMA, { format: 'cjs' });
  const banner = src.split('\n')[0];
  assert.ok(
    banner.includes(VERSION),
    `the first line names the generating version, got ${JSON.stringify(banner)}`,
  );
  assert.ok(banner.includes('do not edit'), 'and still says not to edit it');

  console.log('ok: the banner names the generating version');
}

// --- every generated artifact says who wrote it, and says it in house style --
{
  const { bundleStandalone, bundleCompact } = require('../build.js');
  const artifacts = {
    'cjs module': toStandaloneModule(SCHEMA, { format: 'cjs' }),
    'esm module': toStandaloneModule(SCHEMA, { format: 'esm' }),
    'module with positions': toStandaloneModule(SCHEMA, { format: 'cjs', abortEarly: false, positions: true }),
    'module with parse': toStandaloneModule(SCHEMA, { format: 'cjs', parse: true }),
    'cjs bundle': bundleStandalone([SCHEMA, { type: 'string' }], { format: 'cjs' }),
    'esm bundle': bundleStandalone([SCHEMA, { type: 'string' }], { format: 'esm' }),
    'compact cjs bundle': bundleCompact([SCHEMA, { type: 'string' }], { format: 'cjs' }),
    'compact esm bundle': bundleCompact([SCHEMA, { type: 'string' }], { format: 'esm' }),
    'declaration file': toTypeScript(SCHEMA, { name: 'Config' }),
  };
  for (const [what, src] of Object.entries(artifacts)) {
    assert.ok(
      src.split('\n')[0].includes(`ata-validator ${VERSION}`),
      `${what} names the generating version on its first line, got ${JSON.stringify(src.split('\n')[0])}`,
    );
    // Generated text is public text, and the house style has no em dashes.
    const dash = src.indexOf('—');
    assert.strictEqual(dash, -1, `${what} contains an em dash at ${dash}: ${JSON.stringify(src.slice(Math.max(0, dash - 40), dash + 40))}`);
  }

  console.log(`ok: ${Object.keys(artifacts).length} artifact kinds carry the version, none carry an em dash`);
}

// --- the two axes are independent, which is the whole point ------------------
{
  // Same schema through two calls: the schema hash cannot distinguish them, so
  // it could never have caught a generator change on its own.
  const a = load(toStandaloneModule(SCHEMA, { format: 'cjs' }), 'cjs');
  const b = load(toStandaloneModule(JSON.parse(JSON.stringify(SCHEMA)), { format: 'cjs' }), 'cjs');
  assert.strictEqual(a.schemaHash, b.schemaHash, 'the same schema hashes the same');
  assert.strictEqual(a.ataVersion, b.ataVersion, 'built by the same ata, same version');

  // A build now has both facts available, so a staleness check can ask both
  // questions. This is the contract the docs promise.
  const stale = (mod, schema, installed) =>
    mod.schemaHash !== require('../build.js').schemaHash(schema) || mod.ataVersion !== installed;
  assert.strictEqual(stale(a, SCHEMA, VERSION), false, 'current on both axes');
  assert.strictEqual(stale(a, SCHEMA, '0.0.0'), true, 'a different installed ata reads as stale');
  assert.strictEqual(stale(a, { type: 'string' }, VERSION), true, 'a changed schema still reads as stale');

  console.log('ok: a staleness check can ask about the schema and the generator');
}

// --- the declaration file declares it ---------------------------------------
{
  const dts = toTypeScript(SCHEMA, { name: 'Config' });
  assert.ok(/export declare const ataVersion: string;/.test(dts), 'the .d.ts declares ataVersion');
  assert.ok(/ataVersion: typeof ataVersion/.test(dts), 'and the default export type carries it');

  console.log('ok: the emitted declaration file declares ataVersion');
}
