// lib/kernels/formats.mjs and lib/kernels/formats/ are the current engine's
// generated format checks, one module a format; they have to match the source.
// Regenerate with node scripts/gen-kernels-formats.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, dir } = require('../scripts/gen-kernels-formats.js');
const files = render();
for (const [rel, text] of Object.entries(files)) assert.strictEqual(fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null, text, `lib/kernels/${rel} differs from lib/js-compiler.js; run node scripts/gen-kernels-formats.js`);
for (const name of fs.readdirSync(path.join(dir, 'formats'))) assert.ok(files['formats/' + name] !== undefined, `lib/kernels/formats/${name} is not generated any more; run node scripts/gen-kernels-formats.js`);
console.log(`ok: lib/kernels/formats.mjs and its ${Object.keys(files).length - 1} modules match lib/js-compiler.js`);
