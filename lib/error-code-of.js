'use strict';

// The code a module stamps on an error, from its keyword (and format): the
// first code in sorted order that names the keyword, the same rule as codeFor
// in lib/error-codes.js and the table a module carries (lib/aot-impl.js).
const { CODES } = require('./error-codes');

const byKw = {};
const byFmt = {};
for (const code of Object.keys(CODES).sort()) {
  const c = CODES[code];
  if (byKw[c.keyword] === undefined) byKw[c.keyword] = code;
  if (c.keyword === 'format' && c.format && byFmt[c.format] === undefined) byFmt[c.format] = code;
}

function codeOf(keyword, format) {
  if (keyword === 'format' && format) { const h = byFmt[format]; return h === undefined ? 'ATA3099' : h; }
  const h = byKw[keyword];
  return h === undefined ? null : h;
}

module.exports = { codeOf, byKw, byFmt };
