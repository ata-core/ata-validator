// Structural guard: a browser bundle of `ata-validator` must not pull in
// `fs`/`path`/`pkg-prebuilds`, must not call `readFileSync` at module load,
// and must not bake `__dirname` into the runtime path. The default and browser
// entries hand AOT and native loading off to swap modules (lib/aot.js ->
// lib/aot.browser.js, lib/native-load.js -> lib/native-load.browser.js) via
// the package.json `browser` field. This test re-bundles them and asserts the
// forbidden tokens never appear in executable code.
//
// Comments are stripped before matching so explanatory text that mentions the
// banned identifiers (in this very file's neighbours, for example) doesn't
// false-positive. The signal we care about is whether the runtime touches
// these APIs, not whether their names appear anywhere in the source text.

const esbuild = require('esbuild');
const path = require('path');

const browserEntry = path.join(__dirname, '..', 'index.browser.mjs');
const defaultEntry = path.join(__dirname, '..', 'index.js');

const bannedTokens = [
  'readFileSync',
  'pkg-prebuilds',
  '__dirname',
];

// Build tooling that the `browser` field swaps for stubs. Each token is an
// identifier or string that exists only in the real module, never in its
// stub, so its appearance in a browser bundle means the mapping regressed.
// `lib/aot.js` drags the embedded safe-regex engine source with it, which is
// why the browser bundle cares.
const browserOnlyBannedTokens = [
  'getSafeRegexEmbed',   // lib/aot.js
  'Pike VM',             // lib/safe-regex-source.js (inside the source string)
  'DIVERGENT_FORMATS',   // lib/buffer-gate.js
];

function bundle(entry) {
  const result = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    external: ['fs', 'path', 'pkg-prebuilds', 'yaml'],
    write: false,
    logLevel: 'error',
  });
  return result.outputFiles[0].text;
}

// Strip /* ... */ block comments and `// ...` line comments. esbuild's output
// is well-formed JS, so a regex pass is sufficient; we don't need a full
// tokenizer. The goal is to ignore explanatory prose, not to handle every
// pathological case.
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

let failed = 0;
const check = (cond, msg) => {
  if (!cond) {
    console.log(`  FAIL  ${msg}`);
    failed++;
  } else {
    console.log(`  PASS  ${msg}`);
  }
};

function assertClean(label, entry) {
  const code = stripComments(bundle(entry));
  for (const token of [...bannedTokens, ...browserOnlyBannedTokens]) {
    check(
      !code.includes(token),
      `${label}: bundle contains no \`${token}\``,
    );
  }
}

assertClean('index.browser.mjs', browserEntry);
assertClean('index.js (browser-bundled)', defaultEntry);

console.log(`\n${failed === 0 ? 'ok' : 'FAILED'}: browser bundle stays free of fs/path/__dirname/pkg-prebuilds`);
process.exit(failed > 0 ? 1 : 0);
