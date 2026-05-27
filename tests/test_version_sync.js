'use strict';

// Guard against drift: `lib/version.js` is the runtime version string used by
// `version()` so the browser bundle never has to require package.json. If a
// release bumps package.json without bumping lib/version.js (or vice versa),
// catch it here instead of shipping a wrong version number.

const assert = require('node:assert');
const path = require('node:path');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const libVersion = require(path.join(__dirname, '..', 'lib', 'version'));

assert.strictEqual(
  libVersion,
  pkg.version,
  `lib/version.js (${libVersion}) is out of sync with package.json (${pkg.version}). Update lib/version.js to match.`,
);

console.log(`ok: lib/version.js matches package.json (${libVersion})`);
