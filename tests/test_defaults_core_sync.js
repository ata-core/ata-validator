'use strict';
// lib/defaults-core.js is lib/defaults.js for the plugin's core, with
// patternProperties keys matched on the linear engine the Validator
// registered (the patterns feature); it must not drift.
const assert = require('assert');
const fs = require('fs');
const { render, file, renderMatch, matchFile } = require('../scripts/gen-defaults-core.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/defaults-core.js differs from lib/defaults.js; run node scripts/gen-defaults-core.js');
// lib/defaults-match.js is the same pass with the key matcher handed in, for
// the patternFallback feature on the full 2.0 entries.
assert.strictEqual(fs.readFileSync(matchFile, 'utf8'), renderMatch(), 'lib/defaults-match.js differs from lib/defaults.js; run node scripts/gen-defaults-core.js');
console.log('ok: lib/defaults-core.js and lib/defaults-match.js match lib/defaults.js');
