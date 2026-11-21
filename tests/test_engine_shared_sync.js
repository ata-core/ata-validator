'use strict';
// lib/engine-shared.js is the interpreter's shared code (lib/interpreter-core.js,
// between its engine-shared markers) for the small engine, and
// lib/engine-shared-core.js the same code for the plugin's core, with the
// linear pattern engine handed in (the patterns feature); neither may drift.
const assert = require('assert');
const fs = require('fs');
const { render, file, renderCore, coreFile } = require('../scripts/gen-engine-shared.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/engine-shared.js differs from lib/interpreter-core.js; run node scripts/gen-engine-shared.js');
assert.strictEqual(fs.readFileSync(coreFile, 'utf8'), renderCore(), 'lib/engine-shared-core.js differs from lib/interpreter-core.js; run node scripts/gen-engine-shared.js');
console.log('ok: lib/engine-shared.js and lib/engine-shared-core.js match lib/interpreter-core.js');
