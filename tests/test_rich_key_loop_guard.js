'use strict';

// The rich error program guards each record of a list with the verdict's
// key-loop form when the record has many optional properties (subtreeGuard
// in lib/js-compiler-errors.js). The guard's lines are joined with `;`, and
// the key loop's switch once came out as separate lines, so the guard read
// `switch(k){;case` and the rich compile failed on syntax: the validator
// silently fell back to the plain error program. The rich compile must
// return a function here, and its errors must be the interpreter's.

const assert = require('assert');
const { Validator } = require('..');
const jc = require('../lib/js-compiler.js');

const type = (p) => ['string', 'integer', 'boolean'][p % 3];
const properties = {};
for (let p = 0; p < 150; p++) properties['f' + p] = { type: type(p) };
const schema = { type: 'array', items: { type: 'object', properties, required: ['f0'] } };

const rich = jc.compileToJSCombined(schema, Object.freeze({ valid: true, errors: [] }), null, undefined, { runtimeShape: true, rich: true });
assert.strictEqual(typeof rich, 'function', 'the rich combined program compiles for a key-loop record list');

const val = (p) => type(p) === 'string' ? 'v' + p : type(p) === 'integer' ? p : p % 2 === 0;
const rec = (ks, bad) => { const r = {}; for (const p of ks) r['f' + p] = val(p); if (bad !== undefined) r['f' + bad] = 'wrong'; return r };
const docs = [
  [rec([0, 1, 2]), rec([0, 50, 51]), rec([0, 3], 4)],
  [rec([0, 9]), [1], 'x', null, { f1: 1 }, rec([0, 2, 77, 149], 149)],
  [Object.assign(Object.create({ f5: 'wrong' }), { f0: 'v0' }), { f0: 'v0', f2: undefined }],
  Array.from({ length: 200 }, (_, i) => rec([0, 1, 10 + i % 90], i % 7 === 0 ? 11 + i % 50 : undefined)),
];
const v = new Validator(schema, { useDefaults: false });
const vi = new Validator(schema, { useDefaults: false, engine: 'interpreter' });
const key = (r) => JSON.stringify(r.errors.map((e) => [e.instancePath, e.keyword, e.params]));
let n = 0;
for (const d of docs) for (let i = 0; i < 3; i++) { assert.strictEqual(key(v.validate(d)), key(vi.validate(d)), JSON.stringify(d).slice(0, 80)); n++ }
console.log(`ok: the rich error program guards key-loop records and matches the interpreter (${n} reads)`);
