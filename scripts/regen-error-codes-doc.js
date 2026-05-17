#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { CODES, all } = require('../lib/error-codes');

const lines = [];
lines.push('# ata Error Codes');
lines.push('');
lines.push('Stable registry of `ATA####` codes emitted by ata-validator. Each section is the target of `https://ata-validator.com/e/<code>`.');
lines.push('');

const byCategory = {};
for (const c of all()) {
  const cat = CODES[c].category;
  (byCategory[cat] ||= []).push(c);
}

const order = ['type', 'shape', 'constraint', 'format', 'enum', 'composition', 'ref', 'system'];
for (const cat of order) {
  if (!byCategory[cat]) continue;
  lines.push(`## ${cat}`);
  lines.push('');
  for (const code of byCategory[cat]) {
    const meta = CODES[code];
    lines.push(`### ${code} — ${meta.headline}`);
    lines.push('');
    lines.push(`Keyword: \`${meta.keyword}\`${meta.format ? ` (format: \`${meta.format}\`)` : ''}`);
    lines.push('');
    lines.push('**Cause.** _TODO — fill before release._');
    lines.push('');
    lines.push('**Fix.** _TODO — fill before release._');
    lines.push('');
  }
}

const docPath = path.join(__dirname, '..', 'docs', 'error-codes.md');
fs.writeFileSync(docPath, lines.join('\n') + '\n');
console.log(`wrote ${all().length} sections to docs/error-codes.md`);
