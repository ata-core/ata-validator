// lib/kernels/rank.mjs is the text of lib/schema-order.js's rank functions;
// it must not drift from them. Regenerate with node scripts/gen-kernels-rank.js.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-kernels-rank.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/kernels/rank.mjs differs from lib/schema-order.js; run node scripts/gen-kernels-rank.js');
console.log('ok: lib/kernels/rank.mjs matches lib/schema-order.js');
