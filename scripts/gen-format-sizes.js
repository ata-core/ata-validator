'use strict';
// Writes features/format-sizes.mjs: what each way of registering format
// checks adds to a page's first load, measured with real builds of the
// plugin's core (index.v2.core.mjs), so that featuresFor() (features/index.mjs)
// can name either the per-name features (formatDate, ...) or the groups
// (formats, uri) for a schema's set of formats, whichever is smaller.
//
// Each figure is gzip -9 of an esbuild bundle (browser, ESM, minified) less
// the bare core's:
//   own[feature]   a per-name feature, less the shared parts (lib/fmt/) it reads
//   part[file]     a shared part alone
//   parts[feature] the shared parts a build of that feature carries
//   group          the formats group, the uri group (which reads the formats
//                  group's module), and both registered
//   share          bytes gzip saves per module after the first when several
//                  are on one page, fitted (least squares) to real builds of
//                  the sets SETS lists
// A set's per-name cost is the sum of its features' own figures and of the
// parts they carry, each once, less share for each module past the first.
// tests/test_format_sizes.js holds the choice it gives to real builds.
//
// Run after scripts/gen-group-copies.js, and again when a format check, the
// core or esbuild changes. Node only, at build time.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const esbuild = require('esbuild');
const { NAMES, featureOf } = require('../lib/groups.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'features', 'format-sizes.mjs');

async function gz (src, dir) {
  const r = await esbuild.build({ stdin: { contents: src, resolveDir: dir, sourcefile: 'page.mjs' }, bundle: true, write: false, format: 'esm', platform: 'browser', minify: true, metafile: true, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
  return { gz: r.outputFiles.reduce((n, f) => n + zlib.gzipSync(f.contents, { level: 9 }).length, 0), inputs: Object.keys(r.metafile.inputs) };
}
const lit = (p) => JSON.stringify(path.join(ROOT, p));
const page = (uses, extra = '') => `import { Validator } from ${lit('index.v2.core.mjs')}\n` +
  uses.map(([n, f], i) => `import { ${n} as f${i} } from ${lit('lib/features/' + f)}\n`).join('') +
  (uses.length ? `Validator.use(${uses.map((_, i) => 'f' + i).join(', ')})\n` : '') + extra + 'export { Validator }\n';

// Sets of format names the fit is made on, and the test checks: each name,
// the names from the front and from the back of NAMES, and a spread of mixes.
function SETS () {
  const sets = NAMES.map((n) => [n]);
  for (let k = 2; k <= NAMES.length; k++) sets.push(NAMES.slice(0, k), NAMES.slice(-k));
  for (let i = 0; i < 24; i++) sets.push(NAMES.filter((_, j) => ((j * 7 + i * 13) % 19) < 3 + (i % 12)));
  return sets.filter((x) => x.length > 0);
}
// A set's estimate before the share, and its module count.
function additive (t, features) {
  const parts = new Set(); let n = 0;
  for (const f of features) { n += t.own[f]; for (const p of t.parts[f]) parts.add(p); }
  for (const p of parts) n += t.part[p];
  return [n, features.length + parts.size];
}

async function measure () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-format-sizes-'));
  try {
    const floor = (await gz(page([]), dir)).gz;
    // A part alone carries the parts it reads, so each is counted less
    // those, the ones it reads first.
    const alone = {}; const deps = {};
    for (const f of fs.readdirSync(path.join(ROOT, 'lib/fmt')).sort()) {
      const n = f.replace(/\.js$/, '');
      const r = await gz(page([], `import * as p from ${lit('lib/fmt/' + f)}\nexport { p }\n`), dir);
      alone[n] = r.gz - floor;
      deps[n] = r.inputs.filter((i) => /lib\/fmt\//.test(i)).map((i) => path.basename(i, '.js')).filter((x) => x !== n);
    }
    const part = {};
    for (const n of Object.keys(alone).sort((x, y) => deps[x].length - deps[y].length || (x < y ? -1 : 1))) part[n] = alone[n] - deps[n].reduce((t, q) => t + part[q], 0);
    const own = {}; const parts = {};
    for (const name of NAMES) {
      const f = featureOf(name);
      const r = await gz(page([[f, f + '.js']]), dir);
      parts[f] = r.inputs.filter((i) => /lib\/fmt\//.test(i)).map((i) => path.basename(i, '.js')).sort();
      own[f] = r.gz - floor - parts[f].reduce((n, p) => n + part[p], 0);
    }
    const group = {
      formats: (await gz(page([['formats', 'formats.js']]), dir)).gz - floor,
      uri: (await gz(page([['uri', 'uri.js']]), dir)).gz - floor,
      both: (await gz(page([['formats', 'formats.js'], ['uri', 'uri.js']]), dir)).gz - floor,
    };
    const t = { floor, own, part, parts, group };
    let num = 0; let den = 0;
    for (const set of SETS()) {
      const fs_ = set.map(featureOf);
      const real = (await gz(page(fs_.map((f) => [f, f + '.js'])), dir)).gz - floor;
      const [a, m] = additive(t, fs_);
      num += (a - real) * (m - 1); den += (m - 1) * (m - 1);
    }
    t.share = Math.round(num / den * 10) / 10;
    return t;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function render (t) {
  return '// Generated by scripts/gen-format-sizes.js with esbuild ' + esbuild.version + '. Do not edit.\n' +
    '// Bytes (gzip -9, minified) each way of registering format checks adds to the\n' +
    '// plugin\'s core, which featuresFor() (features/index.mjs) reads to name the\n' +
    '// per-name features or the formats and uri groups, whichever is smaller.\n' +
    `export const FLOOR = ${t.floor};\n` +
    `export const OWN = ${JSON.stringify(t.own)};\n` +
    `export const PART = ${JSON.stringify(t.part)};\n` +
    `export const PARTS = ${JSON.stringify(t.parts)};\n` +
    `export const GROUP = ${JSON.stringify(t.group)};\n` +
    `export const SHARE = ${t.share};\n`;
}

if (require.main === module) measure().then((t) => { fs.writeFileSync(OUT, render(t)); console.log(JSON.stringify(t)); }).catch((e) => { console.error(e); process.exit(1); });
module.exports = { measure, render, gz, page, OUT, SETS };
