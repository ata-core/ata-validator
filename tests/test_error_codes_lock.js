'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { CODES, all } = require('../lib/error-codes');

const lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'error-codes.lock.json'), 'utf8'));

const current = {};
for (const c of all()) {
  current[c] = {
    keyword: CODES[c].keyword,
    category: CODES[c].category,
    format: CODES[c].format || null,
  };
}

const lockCodes = Object.keys(lock).sort();
const liveCodes = Object.keys(current).sort();

// Detect renames/deletions: every code in the lock must still exist with the same shape.
for (const code of lockCodes) {
  assert.ok(current[code], `error code ${code} disappeared (rename or delete forbidden — mark deprecated instead)`);
  assert.deepStrictEqual(current[code], lock[code],
    `error code ${code} changed shape; update tests/error-codes.lock.json in the same PR if intentional`);
}

// Detect adds: every new code must be in the lock.
for (const code of liveCodes) {
  assert.ok(lock[code], `error code ${code} is new — add it to tests/error-codes.lock.json (run: node scripts/regen-lock.js)`);
}

console.log(`ok: ${lockCodes.length} error codes match lockfile`);
