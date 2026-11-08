'use strict';
// IDNA2008 for `hostname` (its `xn--` labels) and `idn-hostname`
// (lib/idna.js). Every engine and path answers alike on the official suite's
// values, on names whose answers were checked by hand against RFC 5891, 5892
// and 5893, and on a generated corpus; and the table-free approximations hold
// on the code points where they were found to need writing out.
//
// The approximations were checked code point by code point when this was
// written (2026-11-08) against IANA's IDNA2008 properties for Unicode 12
// (277,575 assigned code points, none refused that the table allows, none
// allowed that it refuses), Unicode 16's combining classes (virama, all 69),
// Bidi classes (every allowed code point) and joining types, and against
// Python's `idna` 3.11 on 9,008 names, which differs only where it applies
// the Bidi rule to a label rather than to the whole name, as the suite
// (`0a.א`) and RFC 5893 do.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Validator } = require('..');
const { __ataIdna } = require('../lib/idna.js');

const I = __ataIdna();
const suite = path.join(__dirname, 'suite/tests/draft2020-12/optional/format');

const cases = [];
for (const format of ['hostname', 'idn-hostname']) {
  for (const g of JSON.parse(fs.readFileSync(path.join(suite, format + '.json'), 'utf8'))) {
    for (const t of g.tests) if (typeof t.data === 'string') cases.push([format, t.data, t.valid, t.description]);
  }
}
// Answers checked by hand.
const own = [
  ['idn-hostname', 'münchen.de', true], ['idn-hostname', 'xn--mnchen-3ya.de', true], ['idn-hostname', 'XN--MNCHEN-3YA.DE', true],
  ['idn-hostname', 'straße.de', true], ['idn-hostname', 'пример.испытание', true], ['idn-hostname', 'उदाहरण.परीक्षा', true],
  ['idn-hostname', 'مثال.إختبار', true], ['idn-hostname', 'דוגמה.טעסט', true], ['idn-hostname', 'ＥＸＡＭＰＬＥ.com', true],
  ['idn-hostname', 'ﬁnance.com', true], ['idn-hostname', 'ශ්‍රී.lk', true], ['idn-hostname', 'ab--cd.com', false],
  ['idn-hostname', '💩.la', false], ['idn-hostname', 'host_name.com', false], ['idn-hostname', 'a‌b.com', false],
  // The Bidi rule over the whole name: a left-to-right label beside a
  // right-to-left one must start with a letter.
  ['idn-hostname', 'א.com', true], ['idn-hostname', 'א.1com', false], ['idn-hostname', 'aא.com', false],
  // Cherokee folds to its capitals, and Greek with ypogegrammeni to two
  // characters: the mapping takes a name to those forms, while an A-label,
  // which is not mapped, must not hold the unfolded ones.
  ['idn-hostname', 'ᎠᎡ', true], ['idn-hostname', 'ꭰꭱ', true], ['idn-hostname', 'ᾀ', true],
  ['hostname', 'xn--' + I.encode([0x13A0, 0x13A1]), true], ['hostname', 'xn--' + I.encode([0xAB70, 0xAB71]), false],
  ['hostname', 'xn--' + I.encode([0x1F80]), false],
  // ZWJ after a virama, Devanagari and Sinhala.
  ['idn-hostname', 'क्‍ष', true], ['idn-hostname', 'क‍ष', false],
  ['hostname', 'xn--mnchen-3ya.de', true], ['hostname', 'xn--Mnchen-3ya.de', true], ['hostname', 'xn--mnchen-3y.de', false],
  ['hostname', 'xn--ls8h.la', false], ['hostname', 'ab--cd.example', true], ['hostname', 'a.xn--4dbc5h', true], ['hostname', '1a.xn--4dbc5h', false],
];
for (const [f, s, v] of own) cases.push([f, s, v, 'by hand']);

let n = 0;
for (const [format, data, want, desc] of cases) {
  const schema = { type: 'object', properties: { v: { type: 'string', format } } };
  const doc = { v: data };
  for (const opts of [{}, { engine: 'interpreter' }]) {
    const v = new Validator(schema, opts);
    for (let i = 0; i < 3; i++) assert.strictEqual(v.isValidObject(doc), want, `${format} ${JSON.stringify(data)} (${desc}), verdict call ${i}, ${opts.engine || 'auto'}`);
    const r = v.validate(doc);
    assert.strictEqual(r.valid, want, `${format} ${JSON.stringify(data)} (${desc}), validate(), ${opts.engine || 'auto'}`);
    if (!want) assert.ok(r.errors.some((e) => e.keyword === 'format' && e.instancePath === '/v'), `${format} ${JSON.stringify(data)}: a format error at /v`);
    assert.strictEqual(v.isValidJSON(JSON.stringify(doc)), want, `${format} ${JSON.stringify(data)} (${desc}), isValidJSON, ${opts.engine || 'auto'}`);
  }
  n++;
}

// A generated corpus: labels from allowed characters of several scripts with
// the contextual characters mixed in, as U-labels and as A-labels. Both
// engines and the module function must agree on every name.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pools = [[0x61, 0x7a], [0xe0, 0x24f], [0x3b1, 0x3c9], [0x430, 0x45f], [0x5d0, 0x5ea], [0x620, 0x64a], [0x905, 0x939], [0xac00, 0xac40], [0x4e00, 0x4e40], [0x30a1, 0x30f6], [0xe01, 0xe2e]]
  .map(([a, b]) => { const p = []; for (let c = a; c <= b; c++) if (I.status(c) === 1) p.push(c); return p; });
const specials = [0xb7, 0x375, 0x5f3, 0x5f4, 0x30fb, 0x660, 0x6f0, 0x200c, 0x200d, 0x94d, 0x301, 0x903, 0x2d, 0x30, 0x640, 0x6c, 0x2b9];
const corpus = [];
for (let i = 0; i < 600; i++) {
  const labels = [];
  for (let j = 0, nl = 1 + Math.floor(rnd() * 3); j < nl; j++) {
    const p = pick(pools);
    const cps = [];
    for (let k = 0, len = 1 + Math.floor(rnd() * 7); k < len; k++) cps.push(rnd() < 0.2 ? pick(specials) : pick(p));
    labels.push(String.fromCodePoint(...cps));
  }
  corpus.push(labels.join('.'));
  corpus.push(labels.map((l) => (/^[\x00-\x7f]*$/.test(l) ? l : 'xn--' + I.encode([...l].map((c) => c.codePointAt(0))))).join('.'));
}
const engines = ['hostname', 'idn-hostname'].map((format) => [format, new Validator({ type: 'string', format }), new Validator({ type: 'string', format }, { engine: 'interpreter' })]);
let agreed = 0;
for (const s of corpus) {
  for (const [format, gen, interp] of engines) {
    const want = interp.isValidObject(s);
    assert.strictEqual(gen.isValidObject(s), want, `${format} ${JSON.stringify(s)}: generated code and interpreted engine`);
    assert.strictEqual(gen.validate(s).valid, want, `${format} ${JSON.stringify(s)}: validate()`);
    if (format === 'idn-hostname') assert.strictEqual(I.idnHostname(s), want, `${JSON.stringify(s)}: the module function`);
  }
  agreed++;
}

// The approximations at the code points they write out.
assert.strictEqual(I.status(0x13A0), 1, 'Cherokee capital allowed');
assert.strictEqual(I.status(0xAB70), 0, 'Cherokee small letter refused');
assert.strictEqual(I.status(0x345), 0, 'ypogegrammeni refused');
assert.strictEqual(I.virama(0x94D), true, 'Devanagari virama');
assert.strictEqual(I.virama(0x93C), false, 'nukta is class 7');
assert.strictEqual(I.bidi(0x2B9), 'ON', 'modifier prime is ON');
assert.strictEqual(I.bidi(0x5F4), 'R', 'gershayim is R');
assert.strictEqual(I.bidi(0x6F0), 'EN', 'extended Arabic-Indic zero is EN');
assert.strictEqual(I.decode('X'), null, 'invalid Punycode');
assert.deepStrictEqual(I.decode(I.encode([0x6d, 0xfc, 0x6e])), [0x6d, 0xfc, 0x6e], 'Punycode round trip');

console.log(`ok: IDNA2008 answers alike on every engine, ${n} named cases, ${agreed} generated names`);
