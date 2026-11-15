'use strict';
// lib/unique-items-source.js is the text of lib/unique-items.js's helpers as
// generated code embeds them; it must not drift from the functions.
const assert = require('assert');
const fs = require('fs');
const { render, file } = require('../scripts/gen-unique-items-source.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/unique-items-source.js differs from lib/unique-items.js; run node scripts/gen-unique-items-source.js');
console.log('ok: lib/unique-items-source.js matches lib/unique-items.js');
