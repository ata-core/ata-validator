'use strict';
// lib/engine-shared.js is the interpreter's shared code (lib/interpreter-core.js,
// between its engine-shared markers) for the small engine; it must not drift.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-engine-shared.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/engine-shared.js differs from lib/interpreter-core.js; run node scripts/gen-engine-shared.js');
console.log('ok: lib/engine-shared.js matches lib/interpreter-core.js');
