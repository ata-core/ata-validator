'use strict';
// The copies the 2.0 Validator's groups are built from (scripts/gen-group-copies.js)
// must not drift from lib/formats.js and lib/unique-items.js, and the format
// names lib/groups.js asks about must be exactly those lib/formats.js checks:
// a built-in name missing from them would be read as an unknown format, an
// annotation, on a core without the formats group.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, LIB } = require('../scripts/gen-group-copies.js');
for (const [f, src] of Object.entries(render())) {
  assert.strictEqual(fs.readFileSync(path.join(LIB, f), 'utf8'), src, `lib/${f} differs from its source; run node scripts/gen-group-copies.js`);
}
const full = require('../lib/formats.js').formatChecks();
const core = require('../lib/formats-core.js').formatChecks();
const uri = require('../lib/uri-checks.js');
const { FORMATS, URI_FORMATS, formatGroup } = require('../lib/gates.js');
assert.deepStrictEqual(Object.keys(full).sort(), [...FORMATS, ...URI_FORMATS].sort(), 'lib/gates.js names every built-in format');
assert.deepStrictEqual(Object.keys(core).sort(), [...FORMATS].sort(), 'the formats group checks every name but the URI ones');
assert.deepStrictEqual(Object.keys(uri).sort(), [...URI_FORMATS].sort(), 'the uri group checks the URI names');
for (const n of Object.keys(full)) assert.strictEqual(formatGroup(n), URI_FORMATS.has(n) ? 'uri' : 'formats', n);
assert.strictEqual(formatGroup('color'), null, 'an unknown format needs no group');
// The copies answer as their sources on the suite's format documents.
const SUITE = path.join(__dirname, 'suite/tests');
let n = 0;
for (const dialect of ['draft2020-12', 'draft7', 'v1']) {
  const dir = path.join(SUITE, dialect, 'optional/format');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const name = f.replace(/\.json$/, '');
    if (!full[name]) continue;
    const mine = core[name] || uri[name];
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) for (const t of g.tests) {
      if (typeof t.data !== 'string') continue;
      assert.strictEqual(mine(t.data), full[name](t.data), `${name}: ${JSON.stringify(t.data)}`);
      n++;
    }
  }
}
assert.ok(n > 500, 'format documents compared: ' + n);
const uq = require('../lib/unique-items.js');
const dup = require('../lib/unique-dup.js');
const { _deq } = require('../lib/deq.js');
for (const a of [[], [1, 2, 1], [{ a: 1 }, { a: 1 }], Array.from({ length: 40 }, (_, i) => ({ i: i % 30 })), Array.from({ length: 40 }, (_, i) => i)]) {
  assert.deepStrictEqual(dup.duplicatePair(a), uq.duplicatePair(a));
  assert.strictEqual(dup.allDistinct(a), uq.allDistinct(a));
}
assert.strictEqual(_deq({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
console.log(`ok: the group copies match their sources, ${n} format documents answered alike`);
