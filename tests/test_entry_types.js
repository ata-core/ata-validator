'use strict';

// The declarations of the root import under each form it resolves to: the
// Node entry (index.d.ts) with Node's resolution, and the 2.0 entries
// (index.v2.d.ts) under the `browser` and `workerd` conditions, as a bundler
// project with `customConditions` reads them. `ata-validator/v1` is the 1.x
// declarations under every condition. Each file holds lines that must fail
// (@ts-expect-error), so a form that resolved the other declarations fails
// the check.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { TSC_JS } = require('./_tsc.js');

const ROOT = path.join(__dirname, '..');
const tsc = (file, args) => execFileSync(process.execPath, [TSC_JS, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', ...args, path.join(__dirname, file)], { cwd: ROOT, stdio: 'inherit' });

tsc('entry_types_node.ts', ['--module', 'nodenext', '--moduleResolution', 'nodenext', '--esModuleInterop']);
for (const condition of ['browser', 'workerd', 'edge-light']) {
  tsc('entry_types_browser.ts', ['--module', 'esnext', '--moduleResolution', 'bundler', '--customConditions', condition]);
}
// Without the condition a bundler project reads the Node declarations.
tsc('entry_types_node.ts', ['--module', 'esnext', '--moduleResolution', 'bundler', '--esModuleInterop']);

// What the declarations say holds at run time: use() on the Node entries
// returns the class and changes nothing.
const { Validator } = require(ROOT);
const { richErrors } = require(path.join(ROOT, 'lib/features/richErrors.js'));
const assert = require('node:assert');
assert.strictEqual(Validator.use(richErrors), Validator);
assert.strictEqual(Validator.use(), Validator);
const before = JSON.stringify(new Validator({ type: 'string' }).validate(1).errors);
Validator.use(richErrors);
assert.strictEqual(JSON.stringify(new Validator({ type: 'string' }).validate(1).errors), before);
(async () => {
  for (const f of ['index.mjs', 'index.node.mjs', 'index.bundle.mjs']) {
    const m = await import(require('node:url').pathToFileURL(path.join(ROOT, f)).href);
    assert.strictEqual(m.Validator.use(richErrors), m.Validator, f);
  }
  // Only the Node entries assign it: the 1.x edge, browser and lite entries
  // load the class without it, each asked in a process of its own.
  for (const f of ['index.edge.js', 'lite.js']) {
    const out = execFileSync(process.execPath, ['-e', `console.log(typeof require(${JSON.stringify(path.join(ROOT, f))}).Validator.use)`], { encoding: 'utf8' }).trim();
    assert.strictEqual(out, 'undefined', f);
  }
  for (const f of ['index.edge.mjs', 'index.browser.mjs']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `console.log(typeof (await import(${JSON.stringify(require('node:url').pathToFileURL(path.join(ROOT, f)).href)})).Validator.use)`], { encoding: 'utf8' }).trim();
    assert.strictEqual(out, 'undefined', f);
  }
  // ata-validator/v1 from Node is the Node entry.
  assert.strictEqual(require('ata-validator/v1'), require('ata-validator'));
  assert.strictEqual((await import('ata-validator/v1')).Validator, (await import('ata-validator')).Validator);
  console.log('ok: the Node declarations and the 2.0 declarations type-check under their conditions, and Validator.use() on the Node entries returns the class');
})().catch((e) => { console.error(e); process.exit(1); });
