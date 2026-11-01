// lib/kernels/custom.mjs is the text of lib/interpreter-core.js's custom
// keyword order and type bits; it must not drift from them.
// Regenerate with node scripts/gen-kernels-custom.js.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-kernels-custom.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/kernels/custom.mjs differs from lib/interpreter-core.js; run node scripts/gen-kernels-custom.js');
console.log('ok: lib/kernels/custom.mjs matches lib/interpreter-core.js');
