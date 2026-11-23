'use strict';

// Every file an export of the package names, and every file those reach
// through a relative import or require, is in the tarball. `exports` and
// `files` are two lists in package.json that nothing else holds together:
// before 2.0.0 `exports` named ./features and ./v2/plugin-core while `files`
// left their targets out, so an installed copy could not load them.
//
// The file list is what `npm pack --dry-run --json` prints. Each target is
// bundled by esbuild from this tree, once for Node and once for a browser
// (which applies the package's `browser` map), and every input it reads must
// be in the list. A target that is a pattern (./features/*) is checked for
// each file it matches in the list.

const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let esbuild;
try { esbuild = require('esbuild'); } catch { console.log('skip: esbuild is not installed'); process.exit(0); }

const root = path.join(__dirname, '..');
const out = execSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const parsed = JSON.parse(out);
const manifest = Array.isArray(parsed) ? parsed[0] : parsed[Object.keys(parsed)[0]];
const packed = new Set(manifest.files.map((f) => f.path.split(path.sep).join('/')));
const pkg = require(path.join(root, 'package.json'));

// target file -> the exports that name it
const targets = new Map();
(function walk(node, name) {
  if (typeof node === 'string') { if (!targets.has(node)) targets.set(node, new Set()); targets.get(node).add(name); return; }
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k.startsWith('.') ? k : name);
})(pkg.exports, '.');
for (const t of [pkg.main, pkg.module, pkg.types]) if (t) { const k = './' + t.replace(/^\.\//, ''); if (!targets.has(k)) targets.set(k, new Set(['main'])); }
for (const b of Object.values(pkg.bin || {})) { const k = './' + b.replace(/^\.\//, ''); if (!targets.has(k)) targets.set(k, new Set(['bin'])); }

const files = [];
for (const [t, names] of targets) {
  const rel = t.replace(/^\.\//, '');
  if (!rel.includes('*')) { files.push([rel, names]); continue; }
  const [pre, post] = rel.split('*');
  const matched = [...packed].filter((f) => f.startsWith(pre) && f.endsWith(post) && !f.slice(pre.length, f.length - post.length).includes('/'));
  assert.ok(matched.length > 0, `${[...names].join(', ')}: the pattern ${t} matches no file in the tarball`);
  for (const f of matched) files.push([f, names]);
}

// The 2.0 entries are what the browser and worker conditions name.
const dot = pkg.exports['.'];
assert.strictEqual(dot.browser.import, './index.v2.browser.mjs');
assert.strictEqual(dot.browser.require, './index.v2.browser.js');
for (const c of ['workerd', 'edge-light']) {
  assert.strictEqual(dot[c].import, './index.v2.edge.mjs');
  assert.strictEqual(dot[c].require, './index.v2.edge.js');
}
// Node keeps the entries it had.
assert.strictEqual(dot.require, './index.js');
assert.strictEqual(dot.import.default, './index.mjs');

const missing = [];
let bundled = 0;
const reached = new Set();
for (const [rel, names] of files) {
  if (!packed.has(rel)) { missing.push(`${rel} (named by ${[...names].join(', ')})`); continue; }
  if (!/\.(m?js|cjs)$/.test(rel)) continue;
  for (const platform of ['node', 'browser']) {
    let r;
    try {
      r = esbuild.buildSync({ entryPoints: [path.join(root, rel)], absWorkingDir: root, bundle: true, write: false, metafile: true, platform, format: 'esm', logLevel: 'silent', packages: 'external', external: ['*.node'] });
    } catch (e) {
      // A Node-only entry (the CLI, the build tools) does not bundle for a
      // browser; a relative import that resolves to nothing is the failure
      // this test is for, on either platform.
      const unresolved = (e.errors || []).filter((x) => /Could not resolve "\.{1,2}\//.test(x.text));
      assert.deepStrictEqual(unresolved.map((x) => `${x.text} in ${x.location && x.location.file}`), [], `${rel} (${platform}): a relative import resolves to no file`);
      assert.notStrictEqual(platform, 'node', `${rel} does not bundle for Node: ${(e.errors || []).map((x) => x.text).join('; ')}`);
      continue;
    }
    bundled++;
    for (const f of Object.keys(r.metafile.inputs)) {
      if (f.startsWith('node_modules/') || f.startsWith('(disabled)') || f.includes(':')) continue;
      reached.add(f);
      if (!packed.has(f)) missing.push(`${f} (reached from ${rel}, ${platform})`);
    }
  }
}
assert.deepStrictEqual([...new Set(missing)], [], 'files the exports need that the tarball does not carry');

// The require forms give the classes the import forms give.
{
  const b = require(path.join(root, 'index.v2.browser.js'));
  const e = require(path.join(root, 'index.v2.edge.js'));
  const full = require(path.join(root, 'lib/validator-full.js'));
  assert.deepStrictEqual(Object.keys(b), ['Validator']);
  assert.deepStrictEqual(Object.keys(e), ['Validator']);
  assert.strictEqual(b.Validator, full.Validator, 'the browser require form is the class of lib/validator-full.js');
  assert.ok(e.Validator.prototype instanceof full.Validator, 'the edge require form extends it');
  assert.strictEqual(e.Validator.prototype.core, require(path.join(root, 'lib/core/feature.js')), 'with the verdict core');
  assert.strictEqual(new e.Validator({ type: 'string' }).validate(1).valid, false);
  assert.strictEqual(new b.Validator({ type: 'string' }).validate('a').valid, true);
}

console.log(`ok: ${files.length} export targets are in the tarball, and the ${reached.size} files they reach (${bundled} bundles, Node and browser)`);
