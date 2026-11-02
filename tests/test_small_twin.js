'use strict';
// A process that has met many schemas answers a small schema's first calls on
// an interpreted twin and compiles it once it stays in use (lib/codegen-engine.js
// coldTwin): an agent checking each of hundreds of tool schemas a few times
// never pays to compile them. Run without ATA_NO_SMALL_TWIN (tests/run.js sets
// it for every other test). Checked here: the first schemas compile as before,
// later ones start on the twin, the answers and errors do not change across
// the switch, the twin is let go once the validator compiles, and a schema
// whose compiled functions are cached does not build one.
const assert = require('assert');
assert.notStrictEqual(process.env.ATA_NO_SMALL_TWIN, '1', 'this test must run with the small-schema twin on');
const { Validator } = require('../index.js');

const schema = (i) => ({ type: 'object', properties: { ['q' + i]: { type: 'string', minLength: 2 }, n: { type: 'integer', minimum: i }, tags: { type: 'array', items: { type: 'string' } } }, required: ['q' + i], additionalProperties: false });
const good = (i) => ({ ['q' + i]: 'ab', n: i + 1, tags: ['x'] });
const bad = (i) => ({ ['q' + i]: 'a', n: i - 1, tags: [1], extra: true });
const shape = (r) => JSON.stringify([r.valid, (r.errors || []).map((e) => [e.keyword, e.instancePath, e.schemaPath, e.message])]);

const made = [];
for (let i = 0; i < 24; i++) {
  const v = new Validator(schema(i));
  const ref = new Validator(schema(i), { engine: 'interpreter' });
  assert.strictEqual(v.isValidObject(good(i)), true, `schema ${i}: first verdict`);
  made.push({ i, v, twinFirst: v._twin !== undefined && v._twin !== null });
  // Across the switch to compiled code, every answer and error list holds.
  for (let k = 0; k < 70; k++) {
    const d = k % 2 ? good(i) : bad(i);
    assert.strictEqual(shape(v.validate(d)), shape(ref.validate(d)), `schema ${i}, call ${k}: errors`);
    assert.strictEqual(v.isValidObject(d), ref.isValidObject(d), `schema ${i}, call ${k}: verdict`);
  }
}
// Of the first sixteen first calls (this process met no schema before), none
// took the twin; once past them, small schemas do.
const firstTwin = made.findIndex((m) => m.twinFirst);
assert.ok(firstTwin >= 15 && firstTwin <= 17, `the first schema on the twin was number ${firstTwin}`);
assert.ok(made.slice(firstTwin).every((m) => m.twinFirst), 'a small schema past the first sixteen did not start on the twin');
// After its first 64 calls a validator compiles and lets the twin go.
for (const m of made) assert.ok(m.v._twin === null || m.v._twin === undefined, `schema ${m.i}: the twin is still held after compiling`);

// A schema whose compiled functions are cached compiles from the cache.
const again = new Validator(schema(3));
again.isValidObject(good(3));
assert.ok(again._twin === null || again._twin === undefined, 'a cached schema built a twin');

// So does one compiled by a first isValidObject() alone (its verdict-only
// compile caches under another key).
const verdictOnly = { type: 'object', properties: { only: { type: 'integer' } } };
const firstV = new Validator(verdictOnly); for (let k = 0; k < 66; k++) firstV.isValidObject({ only: 1 });
const secondV = new Validator(structuredClone(verdictOnly)); secondV.isValidObject({ only: 1 });
assert.ok(secondV._twin === null || secondV._twin === undefined, 'a schema compiled by isValidObject() built a twin');

// A large schema's twin is let go too.
const big = { type: 'object', properties: Object.fromEntries([...Array(600)].map((_, i) => ['p' + i, { type: 'string', minLength: i % 7, pattern: '^[a-z]*$' }])) };
const bv = new Validator(big);
for (let k = 0; k < 66; k++) bv.isValidObject({ p0: 'a' });
assert.strictEqual(bv._twin, null, 'the large schema still holds its twin after compiling');

console.log(`ok: small schemas start on the twin from number ${firstTwin} on, answer as the interpreter across the switch (${made.length} schemas, 70 calls each), and let it go once compiled`);
