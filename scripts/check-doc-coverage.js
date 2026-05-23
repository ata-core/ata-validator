#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { all } = require('../lib/error-codes');

const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'error-codes.md'), 'utf8');

const missing = [];
const placeholder = [];
for (const code of all()) {
  const headingRe = new RegExp(`^### ${code}\\b`, 'm');
  if (!headingRe.test(doc)) {
    missing.push(code);
    continue;
  }
  // Find the section, ensure it doesn't still say "_TODO — fill before release._"
  const start = doc.search(headingRe);
  const next = doc.slice(start + 4).search(/^### /m);
  const section = next === -1 ? doc.slice(start) : doc.slice(start, start + 4 + next);
  if (section.includes('_TODO')) placeholder.push(code);
}

if (missing.length) {
  console.error(`docs/error-codes.md is missing entries for: ${missing.join(', ')}`);
  process.exit(1);
}
if (placeholder.length && process.env.ATA_ALLOW_DOC_PLACEHOLDERS !== '1') {
  console.error(`docs/error-codes.md has placeholder _TODO sections for: ${placeholder.join(', ')}`);
  console.error('Run: ATA_ALLOW_DOC_PLACEHOLDERS=1 node scripts/check-doc-coverage.js (development only)');
  process.exit(1);
}
console.log(`ok: ${all().length} codes documented`);
