'use strict';
// lib/kernels/safe-re.mjs and lib/ir/pattern-deps.mjs are the linear engine
// and the interpreted engine's choice of engine for a pattern, as ES modules
// made from lib/safe-regex.js and lib/interpreter-core.js; they must not
// drift from them.
// Regenerate with node scripts/gen-kernels-pattern.js.
const assert = require('assert');
const fs = require('fs');
const { OUT, file } = require('../scripts/gen-kernels-pattern.js');
for (const c of OUT) assert.strictEqual(fs.readFileSync(file(c), 'utf8'), c.render(), `lib/kernels/${c.file} differs from its sources; run node scripts/gen-kernels-pattern.js`);
console.log(`ok: ${OUT.map((c) => c.file).join(', ')} match their sources`);
