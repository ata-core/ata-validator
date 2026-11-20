'use strict';
// lib/rejection-core.js is the rejections of lib/rejections.js without the
// enrichment (between its rejection-core markers), for the 2.0 Validator; it
// must not drift.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-rejection-core.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/rejection-core.js differs from lib/rejections.js; run node scripts/gen-rejection-core.js');
console.log('ok: lib/rejection-core.js matches lib/rejections.js');
