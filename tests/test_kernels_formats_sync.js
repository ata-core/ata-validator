// lib/kernels/formats.mjs is the current engine's generated format checks,
// one export each; it must not drift from lib/js-compiler.js.
// Regenerate with node scripts/gen-kernels-formats.js.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-kernels-formats.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/kernels/formats.mjs differs from lib/js-compiler.js; run node scripts/gen-kernels-formats.js');
console.log('ok: lib/kernels/formats.mjs matches lib/js-compiler.js');
