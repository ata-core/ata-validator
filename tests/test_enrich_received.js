'use strict';

// `received` extraction walks a JSON pointer into the failing payload and
// formats the value. It runs for every error on every rejected payload, and it
// dominated the enrichment profile, so this test pins the resolution rules and
// puts a ceiling on the cost.

const assert = require('assert');
const { enrich } = require('../lib/enrich-error');

const typeErr = (instancePath, type) => ({
  keyword: 'type',
  instancePath,
  schemaPath: '#/x',
  params: { type: type || 'integer' },
  message: 'must be ' + (type || 'integer'),
});

const receivedFor = (instancePath, data, type) => enrich(typeErr(instancePath, type), { data }).received;

// Root pointer reports the whole document.
assert.strictEqual(receivedFor('', 42), '42');
assert.strictEqual(receivedFor('', 'hi'), '"hi"');
assert.strictEqual(receivedFor('', { a: 1 }), '{"a":1}');
assert.strictEqual(receivedFor('', [1, 2]), '[array, 2 items]');

// Ordinary and nested segments.
assert.strictEqual(receivedFor('/age', { age: 'thirty' }), '"thirty"');
assert.strictEqual(receivedFor('/address/zip', { address: { zip: 1234 } }), '1234');

// Array indices are plain segments.
assert.strictEqual(receivedFor('/tags/1', { tags: ['a', 'b'] }), '"b"');

// Escaped segments: ~1 is '/', ~0 is '~', and ~01 is '~1' rather than '/'.
assert.strictEqual(receivedFor('/a~1b', { 'a/b': 7 }), '7');
assert.strictEqual(receivedFor('/a~0b', { 'a~b': 8 }), '8');
assert.strictEqual(receivedFor('/a~01b', { 'a~1b': 9 }), '9');
assert.strictEqual(receivedFor('/~1', { '/': 10 }), '10');

// An empty segment is a real key named "".
assert.strictEqual(receivedFor('//x', { '': { x: 11 } }), '11');

// Paths that do not resolve report nothing rather than throwing.
assert.strictEqual(receivedFor('/missing', { age: 1 }), 'undefined');
assert.strictEqual(receivedFor('/a/b/c', { a: null }), undefined);
assert.strictEqual(enrich(typeErr('/age'), {}).received, undefined);

// Falsy roots still resolve: 0 and false are data, not absence.
assert.strictEqual(receivedFor('', 0), '0');
assert.strictEqual(receivedFor('', false), 'false');

// Long strings truncate, long objects report a size instead of the body.
const long = 'x'.repeat(200);
const reprLong = receivedFor('/s', { s: long });
assert.ok(reprLong.length < 70, 'long string is truncated');
assert.ok(reprLong.endsWith('..."'), 'truncation is marked');
// An object too big to show is summarised by its shape, the way an array is.
// Counting keys is O(1) where measuring the serialised size was O(the whole
// subtree), and a `required` error on a large document paid that per error.
const bigObj = {};
for (let i = 0; i < 50; i++) bigObj['k' + i] = i;
assert.strictEqual(receivedFor('/o', { o: bigObj }), '[object, 50 keys]');
assert.strictEqual(receivedFor('/o', { o: { a: 1 } }), '{"a":1}');
assert.strictEqual(receivedFor('/o', { o: {} }), '{}');

// Anything that fitted inline before still fits: a nested object, and a value
// that serialises through its own toJSON.
assert.strictEqual(receivedFor('/o', { o: { nested: { a: 1 } } }), '{"nested":{"a":1}}');
assert.strictEqual(receivedFor('/d', { d: new Date(0) }), '"1970-01-01T00:00:00.000Z"');
assert.strictEqual(receivedFor('/o', { o: { a: [1, 2, 3] } }), '{"a":[1,2,3]}');
assert.strictEqual(receivedFor('/o', { o: { 'a"b': 1 } }), '{"a\\"b":1}');
assert.strictEqual(receivedFor('/o', { o: { u: undefined, a: 1 } }), '{"a":1}');

// The string form matches JSON.stringify wherever a fast path is taken, so a
// quote, a backslash, a control character or an astral pair reads the same as
// it always did.
for (const s of ['plain', '', 'a"b', 'a\\b', 'a\nb', 'tab\there', 'ünïcøde', '😀', '\u2028', 'x'.repeat(58), 'x'.repeat(59)]) {
  const expected = JSON.stringify(s);
  assert.strictEqual(receivedFor('/s', { s }), expected.length > 60 ? expected.slice(0, 57) + '..."' : expected,
    `string repr for ${JSON.stringify(s)}`);
}

// Suggestions still fire off the extracted value.
const coerce = enrich(typeErr('/age'), { data: { age: '30' } });
assert.strictEqual(coerce.suggestion.kind, 'coercion');
const noSuggestion = enrich(typeErr('/age'), { data: { age: 'thirty' } });
assert.strictEqual(noSuggestion.suggestion, undefined);
assert.ok(!('suggestion' in noSuggestion), 'no suggestion means no key, not an undefined one');

// Cost ceiling, calibrated in-process so slow CI hardware scales both sides.
// The reference is a JSON.stringify of the raw error. Walking the pointer with
// a regex split per segment put enrichment at about 2.5x that reference;
// resolving it without the intermediate allocations lands well under it.
//
// The `detail` field adds a measured 14 ns per error (117 to 131 ns on the
// machine that set this number; `rank` adds 2, the anchor lookup 4), which
// took the typical ratio from 1.4x to 1.65x. The ceiling is 2.0x so that the
// headroom above the typical figure is what it was before, and each side is
// the best of three samples so a busy CI runner does not trip it on noise.
function timed (fn) {
  let best = Infinity;
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 200000; i++) fn();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200000; i++) fn();
    const ns = Number(process.hrtime.bigint() - t0) / 200000;
    if (ns < best) best = ns;
  }
  return best;
}
const payload = { id: 7, email: 'a@b.com', age: 'thirty', tags: ['x', 'y'], address: { city: 'Istanbul', zip: '34000' } };
const err = typeErr('/age');
const reference = timed(() => JSON.stringify(err));
const cost = timed(() => enrich(err, { data: payload }));
const ratio = cost / reference;
assert.ok(ratio < 2.0, `enrich costs ${cost.toFixed(0)} ns, ${ratio.toFixed(2)}x a JSON.stringify of the same error; expected under 2.0x`);

// Enrichment must not scale with the volume of the document. `received` used
// to serialise the whole container to decide it was too big to show, so a
// `required` error on a large payload cost a JSON.stringify of that payload,
// once per error. Sizing is bounded by the 60 characters a repr can hold, so
// the two documents below cost the same to enrich although one carries a
// hundred times the data. Width is a separate matter and still costs a key
// enumeration, which no summary of an object can avoid.
const shallowDoc = { rows: [] };
const deepDoc = { rows: [] };
for (let i = 0; i < 10; i++) shallowDoc.rows.push({ id: i, name: 'row ' + i, email: `u${i}@example.com` });
for (let i = 0; i < 1000; i++) deepDoc.rows.push({ id: i, name: 'row ' + i, email: `u${i}@example.com` });
const rootErr = { keyword: 'required', instancePath: '', schemaPath: '#/required', params: { missingProperty: 'tenant' }, message: 'must have required property tenant' };
assert.strictEqual(enrich(rootErr, { data: deepDoc }).received, '[object, 1 key]');
const smallCost = timed(() => enrich(rootErr, { data: shallowDoc }));
const largeCost = timed(() => enrich(rootErr, { data: deepDoc }));
const growth = largeCost / smallCost;
assert.ok(growth < 4, `enriching a document holding 1000 rows costs ${largeCost.toFixed(0)} ns against ${smallCost.toFixed(0)} ns for one holding 10, ${growth.toFixed(1)}x; enrichment is reading the whole document again`);

console.log(`ok: received resolution rules, enrich at ${cost.toFixed(0)} ns (${ratio.toFixed(2)}x reference), flat in document size (${growth.toFixed(2)}x over 100x the keys)`);
