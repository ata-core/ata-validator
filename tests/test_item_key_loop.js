'use strict';

// Arrays of records with many optional properties: generated code checks a
// call's records from their own keys when three of them (first, middle, last)
// list their keys differently, and reads each declared property otherwise.
// Both forms must answer as the interpreter does, on every shape of record.

const assert = require('assert');
const { Validator } = require('..');

const type = (p) => ['string', 'integer', 'boolean'][p % 3];
const good = (p) => (type(p) === 'string' ? 'v' + p : type(p) === 'integer' ? p : p % 2 === 0);
const bad = (p) => (type(p) === 'string' ? p : 'x');
function rng (seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const properties = {};
for (let p = 0; p < 60; p++) properties['f' + p] = { type: type(p) };
const schema = { type: 'array', items: { type: 'object', properties, required: ['f0', 'f1'] } };
const v = new Validator(schema);
const vi = new Validator(schema, { engine: 'interpreter' });

const rand = rng(7);
const record = (sparse) => {
  const r = { f0: good(0), f1: good(1) };
  if (!sparse) { for (let p = 2; p < 8; p++) r['f' + p] = good(p); return r; }
  const n = Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) { const p = 2 + Math.floor(rand() * 58); r['f' + p] = good(p); }
  return r;
};
const mutate = (arr, kind) => {
  const out = arr.map((r) => ({ ...r }));
  const i = Math.floor(rand() * out.length);
  const p = 2 + Math.floor(rand() * 58);
  switch (kind) {
    case 'badOptional': out[i]['f' + p] = bad(p); break;
    case 'missingRequired': delete out[i].f1; break;
    case 'undefinedOptional': out[i]['f' + p] = undefined; break;
    case 'undefinedRequired': out[i].f0 = undefined; break;
    case 'extraKey': out[i].zz = 1; break;
    case 'inherited': out[i] = Object.assign(Object.create({ ['f' + p]: bad(p) }), out[i]); break;
    case 'nonObject': out[i] = 5; break;
    case 'nullItem': out[i] = null; break;
  }
  return out;
};

let checked = 0;
for (const sparse of [false, true]) {
  for (const len of [0, 1, 2, 3, 4, 50]) {
    for (const kind of ['none', 'badOptional', 'missingRequired', 'undefinedOptional', 'undefinedRequired', 'extraKey', 'inherited', 'nonObject', 'nullItem']) {
      for (let rep = 0; rep < 6; rep++) {
        let arr = Array.from({ length: len }, () => record(sparse));
        if (kind !== 'none' && len > 0) arr = mutate(arr, kind);
        const want = vi.validate(arr).valid;
        assert.strictEqual(v.isValidObject(arr), want, `${sparse ? 'sparse' : 'uniform'} len ${len} ${kind}`);
        assert.strictEqual(v.validate(arr).valid, want, `${sparse ? 'sparse' : 'uniform'} len ${len} ${kind} validate`);
        checked++;
      }
    }
  }
}

// The key-loop form is the one taken on mixed records, where code generation runs.
let codegen = true;
try { new Function('return 1'); } catch { codegen = false; }
if (codegen) {
  const src = require('../lib/js-compiler.js').compileToJSCodegen(schema, null, null);
  assert.ok(src && /_sameKeys/.test(String(src._source || src)), 'the generated code chooses per call between the two forms');
}
console.log(`ok: record arrays with many optional properties answer as the interpreter does (${checked} arrays, both forms)`);
