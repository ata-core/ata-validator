'use strict';

const assert = require('node:assert');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build');
const { allDistinct, duplicatePair, _deq, _uqh } = require('../lib/unique-items');

const M = 0x9e3779b1;
const dbl = (hi, lo) => new Float64Array(new Uint32Array([lo >>> 0, hi >>> 0]).buffer)[0];

// 4096 distinct IEEE-754 doubles that share the exact same 32-bit _uqh hash.
const N = 4096;
const collidingNumbers = [];
for (let k = 1; k <= N; k++) {
  const hi = 0x3ff00000 + k;
  collidingNumbers.push(dbl(hi, Math.imul(hi, M)));
}
const h0 = _uqh(collidingNumbers[0]);
for (const x of collidingNumbers) assert.strictEqual(_uqh(x), h0, 'fixture must collide in _uqh');

const shapes = [
  collidingNumbers.concat([{}]),
  collidingNumbers.map((x) => [x]),
  collidingNumbers.map((x) => ({ k: x })),
];

for (const items of shapes) {
  let reads = 0;
  const proxy = new Proxy(items, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
      return Reflect.get(target, prop, receiver);
    },
  });
  const t0 = Date.now();
  assert.strictEqual(allDistinct(proxy), true);
  assert.strictEqual(duplicatePair(proxy), null);
  const ms = Date.now() - t0;
  // Each call reads each element once into a local array (2 * length total).
  assert.ok(reads <= items.length * 4, `too many element reads: ${reads}`);
  assert.ok(ms < 1000, `colliding array of ${items.length} took ${ms} ms`);

  const dup = items.concat([items[17]]);
  assert.strictEqual(allDistinct(dup), false);
  assert.deepStrictEqual(duplicatePair(dup), [17, items.length]);
}

const schema = { type: 'array', uniqueItems: true };
const cg = new Validator(schema);
const ip = new Validator(schema, { engine: 'interpreter' });
const m = { exports: {} };
new Function('module', 'exports', toStandaloneModule(schema, { format: 'cjs' }))(m, m.exports);
for (const items of shapes) {
  assert.strictEqual(cg.validate(items).valid, true);
  assert.strictEqual(ip.validate(items).valid, true);
  assert.strictEqual(m.exports.isValid(items), true);
  const dup = items.concat([items[5]]);
  assert.strictEqual(cg.validate(dup).valid, false);
  assert.strictEqual(ip.validate(dup).valid, false);
  assert.strictEqual(m.exports.isValid(dup), false);
}

// 3,000 random arrays compared against O(n^2) pairwise reference for verdict and exact first duplicate pair.
let seed = 1337;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
const pool = [
  null, true, false, 0, -0, 1, 1.5, 'a', 'b', '',
  [], [1], [1, 2], [2, 1], {}, { a: 1 }, { a: 1, b: 2 }, { b: 2, a: 1 },
  { a: [1, { x: null }] }, { a: [1, { x: 0 }] },
];
const refPair = (arr) => {
  for (let i = 0; i < arr.length - 1; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (_deq(arr[i], arr[j])) return [i, j];
    }
  }
  return null;
};

for (let t = 0; t < 3000; t++) {
  const len = 13 + rnd(20);
  const arr = Array.from({ length: len }, () => pool[rnd(pool.length)]);
  const want = refPair(arr);
  assert.strictEqual(allDistinct(arr), want === null, `allDistinct mismatch on trial ${t}`);
  assert.deepStrictEqual(duplicatePair(arr), want, `duplicatePair mismatch on trial ${t}`);
}

console.log('ok: uniqueItems stays O(n log n) under hash collisions and matches pairwise reference on 3000 random arrays');
