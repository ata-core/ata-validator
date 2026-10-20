'use strict';

// The browser build leaves the plan compiler out of the page's first load
// (lib/interpreter.browser.js, mapped by the package.json browser field): it
// arrives through a dynamic import once the page is idle, and the plain walk
// answers until then. Held here: a splitting bundler puts it in a chunk the
// first load only imports dynamically, the engine answers the same before and
// after it arrives, and it is used once it has.

const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

// The bundle: the plan compiler is reached only through a dynamic import.
{
  const r = esbuild.buildSync({
    stdin: { contents: "import { Validator } from './index.browser.mjs'; new Validator({ type: 'object' }).validate({})", resolveDir: root },
    bundle: true, minify: true, format: 'esm', platform: 'browser', splitting: true,
    outdir: path.join(require('os').tmpdir(), 'ata-plan-lazy'), metafile: true, write: false, logLevel: 'silent',
  });
  const outs = Object.entries(r.metafile.outputs).filter(([f]) => f.endsWith('.js'));
  const holder = outs.find(([, o]) => Object.keys(o.inputs).some((k) => k.endsWith('lib/plan-compiler.js')));
  assert.ok(holder, 'the plan compiler is in the build');
  const [planFile, planOut] = holder;
  assert.ok(!Object.keys(planOut.inputs).some((k) => /validator-core|interpreter-core/.test(k)), 'the plan compiler has a chunk of its own');
  const entry = outs.find(([, o]) => o.entryPoint);
  const firstLoad = new Set([entry[0]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [f, o] of outs) {
      if (!firstLoad.has(f)) continue;
      for (const imp of o.imports) if (imp.kind === 'import-statement' && !firstLoad.has(imp.path)) { firstLoad.add(imp.path); grew = true; }
    }
  }
  assert.ok(!firstLoad.has(planFile), 'the plan compiler is not in the first load');
}

// The engine: the plain walk before, the closure tree after, the same answers.
const core = require('../lib/interpreter.browser.js');
const schema = {
  $defs: { n: { type: 'object', properties: { v: { type: 'integer', minimum: 0 }, kid: { $ref: '#/$defs/n' } }, required: ['v'] } },
  $ref: '#/$defs/n',
};
const docs = [{ v: 1 }, { v: 1, kid: { v: 2, kid: { v: -1 } } }, { kid: {} }, { v: 'x' }, 5, null];
const interp = core.createInterpreter(schema, {});
assert.strictEqual(interp._fastRoot(), null, 'no closure tree before the plan compiler arrives');
assert.strictEqual(interp._fast, undefined, 'and none is decided: the next call asks again');
const before = docs.map((d) => [interp.isValid(d), interp.validate(d)]);

setTimeout(() => {
  assert.notStrictEqual(interp._fastRoot(), null, 'the closure tree once the plan compiler is in');
  const after = docs.map((d) => [interp.isValid(d), interp.validate(d)]);
  assert.deepStrictEqual(after, before, 'the same answers before and after');
  console.log(`ok: the plan compiler is a chunk of its own outside the first load, loaded when idle; ${docs.length} documents answer the same before and after`);
}, 600);
