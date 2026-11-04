'use strict';
// lib/kernels/unique.mjs and lib/kernels/collapse.mjs are lib/unique-items.js
// and lib/branch-collapse.js as ES modules; they must not drift from them.
// Regenerate with node scripts/gen-kernels-cjs.js.
const assert = require('assert');
const fs = require('fs');
const { COPIES, render, file } = require('../scripts/gen-kernels-cjs.js');
for (const c of COPIES) assert.strictEqual(fs.readFileSync(file(c), 'utf8'), render(c), `lib/kernels/${c.file} differs from lib/${c.from}; run node scripts/gen-kernels-cjs.js`);
console.log(`ok: ${COPIES.map((c) => c.file).join(', ')} match their sources`);
