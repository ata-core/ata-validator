#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { CODES, all } = require('../lib/error-codes');

const out = {};
for (const c of all()) {
  out[c] = {
    keyword: CODES[c].keyword,
    category: CODES[c].category,
    format: CODES[c].format || null,
  };
}

const lockPath = path.join(__dirname, '..', 'tests', 'error-codes.lock.json');
fs.writeFileSync(lockPath, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${all().length} codes to ${path.relative(process.cwd(), lockPath)}`);
