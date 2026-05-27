'use strict';

// Guard against drift: `lib/safe-regex-source.js` mirrors `lib/safe-regex.js`
// as a plain string so `lib/aot.js` can embed the engine without a runtime
// fs read. If the engine source changes but the bundled string isn't
// regenerated, the AOT output ships a stale embed. Catch it here.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'lib', 'safe-regex.js'), 'utf8');
const bundled = require(path.join(root, 'lib', 'safe-regex-source'));

assert.strictEqual(
  bundled,
  engine,
  'lib/safe-regex-source.js is out of date. Run `node scripts/regen-safe-regex-source.js`.',
);

console.log('ok: lib/safe-regex-source.js matches lib/safe-regex.js');
