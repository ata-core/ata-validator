// lib/kernels/preprocess.mjs is the text of lib/validator-core.js's coerce and
// remove passes; it must not drift from them.
// Regenerate with node scripts/gen-kernels-preprocess.js.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-kernels-preprocess.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/kernels/preprocess.mjs differs from lib/validator-core.js; run node scripts/gen-kernels-preprocess.js');
console.log('ok: lib/kernels/preprocess.mjs matches lib/validator-core.js');
