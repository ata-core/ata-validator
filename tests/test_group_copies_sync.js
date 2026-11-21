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
const { NAMES, featureOf } = require('../lib/gates.js');
const URI = ['uri', 'uri-reference', 'iri', 'iri-reference'];
assert.deepStrictEqual(Object.keys(full).sort(), [...NAMES].sort(), 'lib/gates.js names every built-in format');
// One feature per name, lib/features/format<Name>.js, holding that check alone
// and registered as part of formats or uri.
const one = {};
for (const n of NAMES) {
  const f = featureOf(n);
  assert.match(f, /^format[A-Z][A-Za-z0-9]*$/, n + ': ' + f);
  const m = require('../lib/features/' + f + '.js');
  assert.deepStrictEqual(Object.keys(m), [f], f + ' exports itself by name');
  assert.ok(Object.isFrozen(m[f]), f + ' is frozen');
  assert.strictEqual(m[f].name, URI.includes(n) ? 'uri' : 'formats', f + ' registers under its group');
  assert.deepStrictEqual(Object.keys(m[f].checks), [n], f + ' checks ' + n + ' alone');
  assert.strictEqual(typeof m[f].checks[n], 'function');
  one[n] = m[f].checks[n];
}
assert.strictEqual(featureOf('date-time'), 'formatDateTime');
assert.strictEqual(featureOf('relative-json-pointer'), 'formatRelativeJsonPointer');
// The formats and uri groups are one module each, apart from the per-name
// modules; they answer alike below.
const core = require('../lib/features/formats.js').formats.checks;
const uri = require('../lib/features/uri.js').uri.checks;
assert.deepStrictEqual(Object.keys(core).sort(), NAMES.filter((n) => !URI.includes(n)).sort(), 'the formats group checks every name but the URI ones');
assert.deepStrictEqual(Object.keys(uri).sort(), [...URI].sort(), 'the uri group checks the URI names');

// No declaration is in two generated modules: a page that registers several
// names carries each piece once.
{
  const seen = new Map();
  for (const f of fs.readdirSync(path.join(LIB, 'fmt')).map((x) => 'fmt/' + x).concat(NAMES.map((n) => 'features/' + featureOf(n) + '.js'))) {
    for (const m of fs.readFileSync(path.join(LIB, f), 'utf8').matchAll(/^(?:function ([\w$]+)|(?:const|let|var) ([\w$]+) =)/gm)) {
      const d = m[1] || m[2];
      assert.ok(!seen.has(d), `${d} is declared in lib/${f} and lib/${seen.get(d)}`);
      seen.set(d, f);
    }
  }
  assert.ok(seen.has('pair') && seen.has('ipv6') && seen.has('_uriWalk') && seen.has('URI_FAST'), 'the shared declarations are there');
  for (const f of fs.readdirSync(path.join(LIB, 'fmt'))) assert.ok(Object.hasOwn(render(), 'fmt/' + f), 'lib/fmt/' + f + ' is generated');
}
// The copies answer as their sources on the suite's format documents.
const SUITE = path.join(__dirname, 'suite/tests');
let n = 0;
for (const dialect of ['draft2020-12', 'draft7', 'v1']) {
  const dir = path.join(SUITE, dialect, 'optional/format');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const name = f.replace(/\.json$/, '');
    if (!full[name]) continue;
    const mine = one[name];
    const grp = core[name] || uri[name];
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) for (const t of g.tests) {
      if (typeof t.data !== 'string') continue;
      assert.strictEqual(mine(t.data), full[name](t.data), `${name}: ${JSON.stringify(t.data)}`);
      assert.strictEqual(grp(t.data), full[name](t.data), `${name} in its group: ${JSON.stringify(t.data)}`);
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
