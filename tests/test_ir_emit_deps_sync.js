// lib/ir/emit-deps.mjs is the text of the pattern unrolling in lib/js-compiler.js
// and of FORMAT_HINTS in lib/suggestions.js; it must not drift from them.
// Regenerate with node scripts/gen-ir-emit-deps.js.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-ir-emit-deps.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/ir/emit-deps.mjs differs from its sources; run node scripts/gen-ir-emit-deps.js');
console.log('ok: lib/ir/emit-deps.mjs matches lib/js-compiler.js and lib/suggestions.js');
