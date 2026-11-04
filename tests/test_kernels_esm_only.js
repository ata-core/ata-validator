'use strict';
// ata-validator/kernels reaches no CommonJS file, except through
// lib/kernels/fill.mjs, a module of its own that a bundle drops when no
// default needs it. A CommonJS file reachable from the helpers stays in some
// bundlers' output even when unused: Next.js with webpack carried
// lib/formats.js, lib/error-codes.js, lib/suggestions.js and four more beside a
// compiled form, 9.9 KB gzipped where the form needs 4.2. Walked here over
// static imports and re-exports from lib/kernels/index.mjs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'lib', 'kernels');
const seen = new Set(); const reached = [];
const walk = (file) => {
  if (seen.has(file)) return; seen.add(file);
  if (path.basename(file) === 'fill.mjs' && path.dirname(file) === dir) return;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/gm)) {
    const to = path.resolve(path.dirname(file), m[1]);
    if (!to.endsWith('.mjs')) { reached.push(path.relative(path.join(__dirname, '..'), file) + ' -> ' + m[1]); continue }
    walk(to);
  }
};
walk(path.join(dir, 'index.mjs'));
assert.deepStrictEqual(reached, [], 'ata-validator/kernels reaches CommonJS files:\n' + reached.join('\n'));
console.log(`ok: ata-validator/kernels is ES modules only (${seen.size} modules)`);
