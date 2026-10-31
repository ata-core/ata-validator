'use strict';

// Ways the native engine answered differently from validate(), crashed, or
// raced, found by an outside scan and each confirmed before it was fixed.
// Every case runs the buffer APIs against validate() on the same document.
// Skipped without the addon.

const assert = require('assert');
const core = require('../lib/validator-core.js');
const { Validator } = require('..');

const native = core._internals.getNative();
if (!native) {
  console.log('skip: native addon not loaded');
  process.exit(0);
}

const pad = (o) => JSON.stringify({ ...o, pad: 'x'.repeat(40) });
let n = 0;
function agree (name, schema, docText, opts) {
  const v = new Validator(schema, opts || {});
  let want;
  try { want = v.validate(JSON.parse(docText)).valid; } catch { want = false; }
  assert.strictEqual(v.isValid(Buffer.from(docText)), want, `${name}: isValid`);
  assert.deepStrictEqual(v.isValidNDJSON(Buffer.from(docText)), [want], `${name}: isValidNDJSON`);
  const big = docText.length < 9000 && docText[0] === '{' ? docText.slice(0, -1) + ',"zz":"' + 'y'.repeat(9000) + '"}' : null;
  if (big) {
    let wantBig;
    try { wantBig = v.validate(JSON.parse(big)).valid; } catch { wantBig = false; }
    assert.strictEqual(v.isValidJSON(big), wantBig, `${name}: isValidJSON above the simdjson threshold`);
  }
  n++;
}

// More than 64 required names: the bitmask that tracked them saturated.
{
  const req = Array.from({ length: 70 }, (_, i) => 'k' + i);
  const doc = {}; for (let i = 0; i < 69; i++) doc['k' + i] = 1;
  agree('70 required, one missing', { type: 'object', required: req }, JSON.stringify(doc));
}
// $dynamicRef was answered by the On-Demand plan without being resolved.
agree('$dynamicRef by anchor', { $defs: { s: { $dynamicAnchor: 's', type: 'string' } }, $dynamicRef: '#s' }, pad({ a: 1 }));
agree('$dynamicRef by pointer', { $defs: { s: { type: 'string' } }, $dynamicRef: '#/$defs/s' }, pad({ a: 1 }));
// A false schema was lowered to "must be null".
agree('false property, null value', { type: 'object', properties: { a: false } }, '{"a":null}');
agree('false property, null value, long', { type: 'object', properties: { a: false } }, pad({ a: null }));
agree('false property under items', { type: 'array', items: { properties: { a: false } } }, '[{"a":null}]');
// Patterns RE2 cannot take were dropped instead of declining the schema.
agree('lookahead', { type: 'string', pattern: '^(?!admin)' }, '"admin"');
agree('lookahead, long', { type: 'object', properties: { u: { type: 'string', pattern: '^(?!admin)' } } }, pad({ u: 'admin' }));
agree('backreference', { type: 'string', pattern: '^(a)\\1$' }, '"ab"');
// A primitive enum let containers through on the On-Demand plan.
agree('enum, object value', { enum: [1, 2, 'a'] }, pad({ a: 1 }));
agree('enum, array value', { enum: [1, 2, 'a'] }, '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]');
agree('empty enum', { type: 'object', properties: { a: { enum: [] } } }, pad({ a: 1 }));
// Counts past 2^32 were narrowed to 32 bits.
agree('minItems 2^32', { type: 'array', minItems: 4294967296 }, '[]');
agree('minLength 2^32', { type: 'string', minLength: 4294967296 }, '"a"');
agree('minProperties 2^32', { type: 'object', minProperties: 4294967296 }, '{}');
// Raw key bytes were compared with decoded names.
agree('required name with a quote', { type: 'object', required: ['x":1,"y'] }, '{"x":1,"y":2,"pad":"xxxxxxxxxxxxxxxxxxxxxxxx"}');
agree('property name with a quote', { type: 'object', properties: { 'a"b': { type: 'string' } } }, '{"a\\"b":1,"pad":"xxxxxxxxxxxxxxxxxxxxxxxxxxx"}');
// ipv6 accepted any string with a colon.
agree('ipv6', { type: 'string', format: 'ipv6' }, '"a:b"');
agree('ipv6, long', { type: 'object', properties: { ip: { type: 'string', format: 'ipv6' } } }, pad({ ip: 'not:an:address' }));
// Formats the engine has no check for, and a caller's own, go to validate().
agree('json-pointer', { type: 'object', properties: { p: { type: 'string', format: 'json-pointer' } } }, pad({ p: 'no-slash' }));
agree('caller format', { type: 'object', properties: { c: { type: 'string', format: 'even' } } }, pad({ c: 'odd' }), { formats: { even: () => false } });
agree('caller format over a built-in name', { type: 'object', properties: { e: { type: 'string', format: 'email' } } }, pad({ e: 'a@b.co' }), { formats: { email: () => false } });
agree('propertyDependencies', { propertyDependencies: { a: { x: { required: ['b'] } } } }, pad({ a: 'x' }));
// A registry entry merged under a name the schema already uses.
agree('registry name collision', { type: 'object', $defs: { __ext_http___x_a: { type: 'string', minLength: 5 } }, properties: { v: { $ref: '#/$defs/__ext_http___x_a' } } }, pad({ v: 1 }), { schemas: { 'http://x/a': {} } });

// A $ref pointer segment std::stoul could not read aborted the process.
for (const ref of ['#/allOf/abc', '#/allOf/99999999999999999999999', '#/allOf/-1']) {
  const s = JSON.stringify({ allOf: [{ type: 'object' }], properties: { a: { $ref: ref } } });
  const slot = native.fastRegister(s);
  assert.strictEqual(native.rawFastValidate(slot, Buffer.from(pad({ a: 1 }))), false, `pointer segment ${ref}`);
}

// In first-error mode every failing array item still got an error with its
// own copy of the path: a long key times the array, gigabytes for 200 KB.
{
  const K = 'k'.repeat(100000);
  const v = new Validator({ allOf: [{ type: 'object', properties: { [K]: { type: 'array', items: { type: 'string' } } } }] });
  const doc = Buffer.from('{"' + K + '":[' + Array(10000).fill('1').join(',') + ']}');
  const before = process.memoryUsage().rss;
  const t = process.hrtime.bigint();
  assert.strictEqual(v.isValid(doc), false);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const grew = (process.memoryUsage().rss - before) / 1048576;
  assert.ok(grew < 200, `first-error walk grew the process by ${grew.toFixed(0)} MB`);
  assert.ok(ms < 200, `first-error walk took ${ms.toFixed(0)} ms`);
}

// The prepadded entry holds the caller's length to the buffer.
{
  const v = new Validator({ type: 'object', propertyNames: { maxLength: 3 } });
  const buf = Buffer.from('{"a":1}');
  assert.strictEqual(v.isValidPrepadded(buf, buf.length + 1000), false);
  assert.strictEqual(v.isValidPrepadded(buf, -1), false);
}

// Worker threads register schemas concurrently; the registry raced and
// slots answered false for every document.
const { Worker } = require('worker_threads');
const workerSrc = `
const { workerData, parentPort } = require('worker_threads');
const native = require(${JSON.stringify(require.resolve('../lib/native-load.js'))})();
let bad = 0;
const slots = [];
for (let i = 0; i < 300; i++) {
  const key = 'w' + workerData + '_' + i;
  const s = JSON.stringify({ type: 'object', required: [key], properties: { [key]: { type: 'integer' } } });
  slots.push([key, native.fastRegister(s)]);
}
for (const [key, slot] of slots) {
  const ok = native.rawFastValidate(slot, Buffer.from('{"' + key + '":1,"pad":"xxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'));
  const ko = native.rawFastValidate(slot, Buffer.from('{"' + key + '":"s","pad":"xxxxxxxxxxxxxxxxxxxxxxxxxxx"}'));
  if (ok !== true || ko !== false) bad++;
}
parentPort.postMessage(bad);
`;
(async () => {
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => new Promise((resolve, reject) => {
    const w = new Worker(workerSrc, { eval: true, workerData: i });
    w.once('message', resolve);
    w.once('error', reject);
  })));
  assert.strictEqual(results.reduce((a, b) => a + b, 0), 0, 'slots registered from worker threads answer for their own schema');
  console.log(`ok: the buffer APIs agree with validate() on ${n} shapes, survive bad pointer segments, stop at the first error, and register from workers`);
})().catch((e) => { console.error(e); process.exit(1); });
