'use strict';

// Three ways the native engine could accept or read what it should not, held
// on the addon directly and on the public APIs that ask it. Skipped without
// the addon.
//
// - Object enum and const values were compared through a canonical text that
//   put member names between quotes unescaped, so {"a\":1,\"b": 2} read as
//   {"a": 1, "b": 2} and passed an enum or const of the second.
// - Past its depth limit the walker returned as if the rest were valid: under
//   a recursive schema a violation fifty levels down was accepted.
// - The parallel NDJSON paths read REQUIRED_PADDING bytes past a line that
//   ended near the end of the caller's buffer, and isValidPrepadded() read as
//   many bytes as the caller said, whatever the buffer's size.

const assert = require('assert');
const core = require('../lib/validator-core.js');
const { Validator } = require('..');

const native = core._internals.getNative();
if (!native) {
  console.log('skip: native addon not loaded');
  process.exit(0);
}

const EVIL = '{"a\\":1,\\"b":2}';
assert.deepStrictEqual(Object.keys(JSON.parse(EVIL)), ['a":1,"b']);
const pad = ' '.repeat(20000);

// Object enum and const.
for (const schema of [{ enum: [{ a: 1, b: 2 }] }, { const: { a: 1, b: 2 } }]) {
  const c = new native.CompiledSchema(JSON.stringify(schema));
  assert.strictEqual(c.isValidJSON(EVIL), false, 'addon isValidJSON: ' + JSON.stringify(schema));
  assert.strictEqual(c.validateJSON(EVIL).valid, false, 'addon validateJSON: ' + JSON.stringify(schema));
  assert.strictEqual(c.isValidJSON('{"b":2,"a":1}'), true, 'the allowed object, keys in another order');
  const v = new Validator(schema);
  assert.strictEqual(v.isValid(Buffer.from(EVIL)), false);
  assert.strictEqual(v.isValidJSON(EVIL + pad), false);
  assert.strictEqual(v.validateJSON(EVIL + pad).valid, false);
  assert.strictEqual(v.countValid(Buffer.from((EVIL + '\n').repeat(40))), 0);
  assert.strictEqual(v.isValidParallel(Buffer.from((EVIL + '\n').repeat(40))).some(Boolean), false);
  assert.strictEqual(v.isValid(Buffer.from('{"b":2,"a":1}')), true);
}
{
  const u = new native.CompiledSchema(JSON.stringify({ uniqueItems: true }));
  assert.strictEqual(u.isValidJSON('[{"a":1,"b":2},' + EVIL + ']'), true, 'two different objects are unique');
  assert.strictEqual(u.isValidJSON('[{"a":1},{"a":1}]'), false);
}

// Depth: the addon rejects past its limit; the public APIs answer as validate().
const recursive = { type: 'object', properties: { next: { $ref: '#' }, data: { type: 'string', pattern: '^[A-Z0-9]+$' } }, required: ['data'], additionalProperties: false };
const nest = (k, bad) => { let o = { data: bad ? 'lower' : 'OK' }; for (let i = 0; i < k; i++) o = { data: 'OK', next: o }; return o; };
{
  const c = new native.CompiledSchema(JSON.stringify(recursive));
  const bad = JSON.stringify(nest(80, true));
  assert.strictEqual(c.validateJSON(bad).valid, false, 'addon validateJSON past the limit');
  assert.strictEqual(c.isValidJSON(bad), false, 'addon isValidJSON past the limit');
  assert.strictEqual(c.validate(nest(80, true)).valid, false, 'addon validate(object) past the limit');
  const r = c.validateJSON(JSON.stringify(nest(80, false)));
  assert.strictEqual(r.valid, false, 'the addon fails closed past its limit');
  assert.ok(r.errors.some((e) => /deeper than the native engine walks/.test(e.message)));
}
{
  const v = new Validator(recursive);
  for (const k of [10, 50, 300]) {
    const bad = JSON.stringify(nest(k, true)), good = JSON.stringify(nest(k, false));
    assert.strictEqual(v.isValid(Buffer.from(bad)), false, `isValid, ${k} deep`);
    assert.strictEqual(v.isValidJSON(bad + pad), false, `isValidJSON, ${k} deep`);
    assert.strictEqual(v.validateJSON(bad + pad).valid, false, `validateJSON, ${k} deep`);
    assert.strictEqual(v.isValidParallel(Buffer.from((bad + '\n').repeat(40))).some(Boolean), false, `isValidParallel, ${k} deep`);
    assert.strictEqual(v.isValid(Buffer.from(good)), true, `isValid accepts ${k} deep`);
    assert.strictEqual(v.isValidJSON(good + pad), true, `isValidJSON accepts ${k} deep`);
    assert.strictEqual(v.isValidParallel(Buffer.from((good + '\n').repeat(40))).every(Boolean), true, `isValidParallel accepts ${k} deep`);
  }
}

// Lines near the end of the buffer, and the caller's length.
{
  const schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] };
  const v = new Validator(schema);
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push(i % 7 === 0 ? '{"n":"x"}' : `{"n":${i}}`);
  const want = lines.map((l) => v.validate(JSON.parse(l)).valid);
  for (const tail of ['', '\n']) {
    const text = lines.join('\n') + tail;
    // Exactly the bytes, no slack after the last line.
    const exact = Buffer.from(text);
    assert.deepStrictEqual(v.isValidParallel(exact), want, 'isValidParallel, last line at the end of the buffer' + JSON.stringify(tail));
    assert.strictEqual(v.countValid(exact), want.filter(Boolean).length);
    const u8 = new Uint8Array(exact);
    assert.deepStrictEqual(v.isValidParallel(u8), want);
  }
  const doc = Buffer.from('{"n":1}');
  assert.strictEqual(v.isValidPrepadded(doc, doc.length), true, 'no padding: the copying path answers');
  assert.strictEqual(native.rawFastValidate(v._fastSlot, doc, doc.length + 4096), false, 'a length past the buffer reads nothing');
  const padded = Buffer.alloc(doc.length + 64);
  doc.copy(padded);
  assert.strictEqual(v.isValidPrepadded(padded, doc.length), true);
}

console.log('ok: object enum and const compare member names exactly, the native walker fails closed past its depth and the public APIs answer as validate() at 300 deep, NDJSON lines at the end of the buffer and caller lengths stay inside it');
