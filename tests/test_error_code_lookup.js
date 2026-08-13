'use strict';

// codeFor() runs once per error on every failing validation. It used to rebuild
// and sort the whole code table on each call, which cost around 740 ns and made
// up most of the enrichment cost of a rejected payload. This test pins both
// halves of the fix: the mapping must stay exactly what the linear scan
// produced, and the lookup must not walk the table again per call.

const assert = require('assert');
const { CODES, all, codeFor } = require('../lib/error-codes');

// Reference implementation: the original linear scan over sorted codes.
function referenceCodeFor (keyword, format) {
  if (keyword === 'format' && format) {
    for (const c of all()) {
      const meta = CODES[c];
      if (meta.keyword === 'format' && meta.format === format) return c;
    }
    return 'ATA3099';
  }
  for (const c of all()) {
    if (CODES[c].keyword === keyword) return c;
  }
  return null;
}

// 1. Same answer as the scan for every keyword and format the table knows,
// plus the inputs that fall off the end of it.
const keywords = new Set(all().map((c) => CODES[c].keyword));
const formats = new Set(all().map((c) => CODES[c].format).filter(Boolean));

for (const kw of keywords) {
  assert.strictEqual(codeFor(kw), referenceCodeFor(kw), `codeFor(${kw})`);
  assert.strictEqual(codeFor(kw, 'email'), referenceCodeFor(kw, 'email'), `codeFor(${kw}, email)`);
}
for (const f of formats) {
  assert.strictEqual(codeFor('format', f), referenceCodeFor('format', f), `codeFor(format, ${f})`);
}
for (const unknown of ['nope', '', 'Type', 'contentEncoding']) {
  assert.strictEqual(codeFor(unknown), referenceCodeFor(unknown), `codeFor(${JSON.stringify(unknown)})`);
  assert.strictEqual(codeFor('format', unknown), referenceCodeFor('format', unknown), `codeFor(format, ${unknown})`);
}
for (const empty of [undefined, null]) {
  assert.strictEqual(codeFor('format', empty), referenceCodeFor('format', empty), 'codeFor(format, empty)');
}

// A first match that is not the first code in the table: `type` has two codes
// and both scan and lookup must settle on the lower one.
assert.strictEqual(codeFor('type'), 'ATA1001');
assert.strictEqual(codeFor('oneOf'), 'ATA4001');
assert.strictEqual(codeFor('format', 'not-a-known-format'), 'ATA3099');

// 2. Cost guard. A per-call table walk lands around 740 ns on a fast machine;
// a precomputed lookup is two orders of magnitude under that. The threshold is
// loose enough for slow CI hardware and still fails the scan everywhere.
const mixed = ['type', 'const', 'enum', 'required', 'not', 'oneOf', 'uniqueItems', 'pattern', 'nope'];
const ITERS = 200000;
for (let i = 0; i < 20000; i++) codeFor(mixed[i % mixed.length]); // warm up
let sink = null;
const t0 = process.hrtime.bigint();
for (let i = 0; i < ITERS; i++) sink = codeFor(mixed[i % mixed.length]);
for (let i = 0; i < ITERS; i++) sink = codeFor('format', 'email');
const ns = Number(process.hrtime.bigint() - t0) / (ITERS * 2);
assert.ok(sink !== undefined, 'lookup returned');
assert.ok(ns < 200, `codeFor costs ${ns.toFixed(0)} ns/call; expected under 200 ns (is it still scanning the table?)`);

console.log(`ok: codeFor matches the scan for ${keywords.size} keywords, ${formats.size} formats, at ${ns.toFixed(0)} ns/call`);
