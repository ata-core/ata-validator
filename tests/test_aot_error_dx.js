'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const assert = require('assert');

const fixturePath = path.join(__dirname, 'fixtures/error-dx/user.schema.json');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-aot-dx-'));
const outFile = path.join(outDir, 'user.validator.mjs');
const outFile2 = path.join(outDir, 'user.validator.min.mjs');

(async () => {
  try {
    // Compile with source map on
    execSync(`node ${path.join(__dirname, '..', 'bin', 'ata.js')} compile ${fixturePath} -o ${outFile} --source`, { stdio: 'pipe' });

    const mod = await import('file://' + outFile);
    const r = mod.validate({ name: 'M', email: 'nope', age: -3 });
    assert.strictEqual(r.valid, false);

    const byCode = {};
    for (const e of r.errors) byCode[e.code] = e;

    assert.ok(byCode.ATA2001, 'minLength code missing');
    assert.ok(byCode.ATA3001, 'format email code missing');
    assert.ok(byCode.ATA2003, 'minimum code missing');

    // docUrl is always present (no source map required)
    assert.ok(byCode.ATA2001.docUrl.endsWith('ATA2001'), 'docUrl missing or wrong');

    // Source frame must be present when --source is on
    assert.ok(byCode.ATA3001.schemaSource, 'schemaSource missing on AOT error');
    assert.ok(byCode.ATA3001.schemaSource.line > 0, 'schemaSource.line must be positive');
    assert.ok(byCode.ATA3001.schemaSource.file.endsWith('user.schema.json'), 'schemaSource.file must point at fixture');
    assert.ok(typeof byCode.ATA3001.schemaSource.text === 'string', 'schemaSource.text must be a string');

    console.log('ok: AOT --source compiled validator carries code/docUrl/schemaSource');

    // Now compile with --no-source and assert schemaSource is absent
    execSync(`node ${path.join(__dirname, '..', 'bin', 'ata.js')} compile ${fixturePath} -o ${outFile2} --no-source`, { stdio: 'pipe' });
    const mod2 = await import('file://' + outFile2);
    const r2 = mod2.validate({ name: 'M', email: 'nope', age: -3 });
    assert.strictEqual(r2.valid, false);
    for (const e of r2.errors) {
      assert.strictEqual(e.schemaSource, undefined, '--no-source should omit schemaSource');
      assert.ok(typeof e.code === 'string' && e.code.startsWith('ATA'), '--no-source still keeps code');
      assert.ok(typeof e.docUrl === 'string' && e.docUrl.includes('/e/'), '--no-source still keeps docUrl');
    }

    console.log('ok: AOT --no-source compiled validator omits schemaSource but keeps code/docUrl');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
