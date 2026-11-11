'use strict';

// ata-validator/error-runtime as a bundle holds it: a compact module that
// fills no default imports createErrors alone, and the bundle must not carry
// the defaults pass (lib/defaults.js) for it. The entry required it inside
// createDefaults, which a bundler cannot leave out, 1.6 KB gzipped of every
// bundle with a compact module. The ES module entry now imports the pass on
// its own, behind a pure call. Both entries keep the same five names and the
// same answers.

const assert = require('node:assert');
const path = require('node:path');
const zlib = require('node:zlib');
const esbuild = require('esbuild');

const entry = path.join(__dirname, '..', 'error-runtime.mjs');
function bundle(names, platform) {
  const r = esbuild.buildSync({ stdin: { contents: `import { ${names} } from ${JSON.stringify(entry)}; globalThis.x = [${names}]`, resolveDir: __dirname, loader: 'js' }, bundle: true, minify: true, format: 'esm', platform, write: false, metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(Object.values(r.metafile.outputs)[0].inputs);
  return { gz: zlib.gzipSync(r.outputFiles[0].text, { level: 9 }).length, defaults: inputs.some((k) => k.endsWith('lib/defaults.js')), core: inputs.some((k) => k.endsWith('lib/interpreter-core.js')) };
}
for (const platform of ['browser', 'node']) {
  const errors = bundle('createErrors', platform);
  const both = bundle('createErrors, createDefaults', platform);
  assert.strictEqual(errors.core, true);
  assert.strictEqual(errors.defaults, false, `${platform}: a bundle that fills no default carries lib/defaults.js`);
  assert.strictEqual(both.defaults, true);
  assert.ok(both.gz - errors.gz > 1000, `${platform}: the defaults pass is ${both.gz - errors.gz} bytes gzipped`);
}

const cjs = require('../error-runtime.js');
const NAMES = ['ataVersion', 'compileSafe', 'createDefaults', 'createErrors', 'uriWalk'];
assert.deepStrictEqual(Object.keys(cjs).sort(), NAMES);
import('../error-runtime.mjs').then((esm) => {
  assert.deepStrictEqual(Object.keys(esm).filter((k) => k !== 'default').sort(), NAMES);
  assert.deepStrictEqual(Object.keys(esm.default).sort(), NAMES);
  const schema = { type: 'object', properties: { a: { default: 1 }, b: { type: 'string' } } };
  for (const m of [cjs, esm, esm.default]) {
    const d = {}; m.createDefaults(schema)(d);
    assert.deepStrictEqual(d, { a: 1 });
    const none = {}; m.createDefaults({ type: 'object' })(none);
    assert.deepStrictEqual(none, {});
    assert.strictEqual(m.createErrors(schema)({ b: 1 })[0].keyword, 'type');
    assert.strictEqual(m.ataVersion, cjs.ataVersion);
  }
  const b = bundle('createErrors', 'browser');
  console.log(`ok: ata-validator/error-runtime leaves the defaults pass out of a bundle that fills none (${b.gz} bytes gzipped for a browser)`);
});
