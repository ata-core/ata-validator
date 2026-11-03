'use strict';
// A process that has met many schemas answers a small schema's first calls on
// the interpreted engine alone (lib/codegen-engine.js SmallTwin): a verdict, and
// a valid document's validate(). A document that fails, or a JSON-text call,
// compiles the validator, which answers it as always. Run without
// ATA_NO_SMALL_TWIN (tests/run.js sets it for every other test). Checked here:
// the first schemas compile as before, later ones start on the twin, answers
// and error lists do not change across the switch, the valid result keeps its
// shape, a cached schema and a schema with defaults do not take the twin, and a
// registry changed while on the twin is read when the validator compiles.
const assert = require('assert');
assert.notStrictEqual(process.env.ATA_NO_SMALL_TWIN, '1', 'this test must run with the small-schema twin on');
const { Validator } = require('../index.js');

const schema = (i) => ({ type: 'object', properties: { ['q' + i]: { type: 'string', minLength: 2 }, n: { type: 'integer', minimum: i }, tags: { type: 'array', items: { type: 'string' } } }, required: ['q' + i], additionalProperties: false });
const good = (i) => ({ ['q' + i]: 'ab', n: i + 1, tags: ['x'] });
const bad = (i) => ({ ['q' + i]: 'a', n: i - 1, tags: [1], extra: true });
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message])]);
const onTwin = (v) => v._twin !== undefined && v._twin !== null && typeof v._twin.validate === 'function' && !(v._twin instanceof Validator);

const made = [];
for (let i = 0; i < 24; i++) {
  const v = new Validator(schema(i));
  const ref = new Validator(schema(i), { engine: 'interpreter' });
  // Valid documents first: on the twin while they pass.
  for (let k = 0; k < 5; k++) {
    const g = good(i);
    const r = v.validate(g);
    assert.strictEqual(r.valid, true, `schema ${i}: valid document`);
    assert.strictEqual(r.data, g, `schema ${i}: the valid result carries the document`);
    assert.deepStrictEqual(r.errors, [], `schema ${i}: the valid result has no errors`);
    assert.strictEqual(v.isValidObject(g), true, `schema ${i}: verdict`);
  }
  made.push({ i, v, twin: onTwin(v) });
  // Then a mix: the first failing document compiles; every answer holds.
  for (let k = 0; k < 40; k++) {
    const d = k % 3 ? good(i) : bad(i);
    assert.strictEqual(shape(v.validate(d)), shape(ref.validate(d)), `schema ${i}, call ${k}: errors`);
    assert.strictEqual(v.isValidObject(d), ref.isValidObject(d), `schema ${i}, call ${k}: verdict`);
  }
  assert.ok(!onTwin(v), `schema ${i}: still on the twin after a failing document`);
}
const firstTwin = made.findIndex((m) => m.twin);
assert.ok(firstTwin >= 15 && firstTwin <= 17, `the first schema on the twin was number ${firstTwin}`);
assert.ok(made.slice(firstTwin).every((m) => m.twin), 'a small schema past the first sixteen did not start on the twin');

// A schema whose compiled functions are cached compiles from the cache.
const again = new Validator(schema(3));
again.validate(good(3));
assert.ok(!onTwin(again), 'a cached schema took the twin');

// A schema with defaults fills them, which the twin does not do: it compiles.
const filled = new Validator({ type: 'object', properties: { a: { type: 'string', default: 'x' } } });
const doc = {};
filled.validate(doc);
assert.ok(!onTwin(filled), 'a schema with defaults took the twin');
assert.strictEqual(doc.a, 'x', 'the default was not filled');

// A JSON-text call compiles and answers as always.
const text = new Validator(schema(100));
assert.strictEqual(text.isValidObject(good(100)), true);
assert.ok(onTwin(text), 'schema 100 did not start on the twin');
assert.strictEqual(text.validateJSON(JSON.stringify(bad(100))).valid, false, 'validateJSON on a failing text');
assert.strictEqual(text.isValidJSON(JSON.stringify(good(100))), true, 'isValidJSON on a valid text');

// A registry changed while the validator is on the twin is read when it
// compiles: the first failing document after addSchema() answers against it.
const root = { type: 'object', properties: { v: { $ref: 'http://x/a' }, k: { type: 'string' } } };
const reg = new Validator(root, { schemas: [{ $id: 'http://x/a', type: ['number', 'string'] }] });
assert.strictEqual(reg.isValidObject({ v: 'str' }), true, 'the loose definition accepts a string');
reg.addSchema({ $id: 'http://x/a', type: 'number' });
assert.strictEqual(reg.validate({ v: 'str' }).valid, false, 'after addSchema, the stricter definition rejects the string');
assert.strictEqual(reg.isValidObject({ v: 'str' }), false, 'and keeps rejecting it');

// The same with a verdict first after addSchema(), which the twin answers.
const reg2 = new Validator(root, { schemas: [{ $id: 'http://x/a', type: ['number', 'string'] }] });
assert.strictEqual(reg2.isValidObject({ v: 'str' }), true);
assert.ok(onTwin(reg2), 'reg2 did not start on the twin');
reg2.addSchema({ $id: 'http://x/a', type: 'number' });
assert.strictEqual(reg2.isValidObject({ v: 'str' }), false, 'a verdict after addSchema answered against the old registry');

console.log(`ok: small schemas start on the interpreted twin from number ${firstTwin} on and answer as the interpreter across the switch (${made.length} schemas)`);
