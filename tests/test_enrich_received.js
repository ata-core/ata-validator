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
const bigObj = {};
for (let i = 0; i < 50; i++) bigObj['k' + i] = i;
assert.ok(/^\[object, ~[\d.]+KB\]$/.test(receivedFor('/o', { o: bigObj })), 'large object reports size');

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
function timed (fn) {
  for (let i = 0; i < 200000; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200000; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 200000;
}
const payload = { id: 7, email: 'a@b.com', age: 'thirty', tags: ['x', 'y'], address: { city: 'Istanbul', zip: '34000' } };
const err = typeErr('/age');
const reference = timed(() => JSON.stringify(err));
const cost = timed(() => enrich(err, { data: payload }));
const ratio = cost / reference;
assert.ok(ratio < 1.8, `enrich costs ${cost.toFixed(0)} ns, ${ratio.toFixed(2)}x a JSON.stringify of the same error; expected under 1.8x`);

console.log(`ok: received resolution rules, enrich at ${cost.toFixed(0)} ns (${ratio.toFixed(2)}x reference)`);
