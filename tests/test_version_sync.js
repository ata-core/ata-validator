'use strict';

// Guard against drift: `lib/version.js` is the runtime version string used by
// `version()` so the browser bundle never has to require package.json. If a
// release bumps package.json without bumping lib/version.js (or vice versa),
// catch it here instead of shipping a wrong version number.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const libVersion = require(path.join(__dirname, '..', 'lib', 'version'));

assert.strictEqual(
  libVersion,
  pkg.version,
  `lib/version.js (${libVersion}) is out of sync with package.json (${pkg.version}). Update lib/version.js to match.`,
);

// The native addon reports ATA_VERSION from include/ata.h and version()
// prefers the native answer, so a stale header ships a wrong version number
// to every prebuild user (1.0.0 shipped reporting 0.10.4 this way). The
// header must carry the same version, and both spellings inside it must
// agree: the ATA_VERSION define and the VERSION_MAJOR/MINOR/REVISION triple.
const header = fs.readFileSync(path.join(__dirname, '..', 'include', 'ata.h'), 'utf8');
const define = header.match(/#define ATA_VERSION "([^"]+)"/);
assert.ok(define, 'include/ata.h: ATA_VERSION define not found');
assert.strictEqual(
  define[1],
  pkg.version,
  `include/ata.h ATA_VERSION (${define[1]}) is out of sync with package.json (${pkg.version}). Update the define and the VERSION_* constants.`,
);

const triple = ['MAJOR', 'MINOR', 'REVISION'].map((part) => {
  const m = header.match(new RegExp(`VERSION_${part} = (\\d+)`));
  assert.ok(m, `include/ata.h: VERSION_${part} constant not found`);
  return m[1];
}).join('.');
assert.strictEqual(
  triple,
  pkg.version,
  `include/ata.h VERSION_* constants (${triple}) are out of sync with package.json (${pkg.version}).`,
);

console.log(`ok: lib/version.js and include/ata.h match package.json (${libVersion})`);
