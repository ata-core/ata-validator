'use strict';

const assert = require('node:assert');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build');
const U = require('../lib/unique-items');
const src = require('../lib/unique-items-source');
const { allDistinct, duplicatePair, _deq, _uqh, _uqcmp } = U;

const EXPECTED_CHECKS = 49439;
let checks = 0;
const check = (cond, message) => { checks++; assert.ok(cond, message); };
const same = (actual, expected, message) => { checks++; assert.deepStrictEqual(actual, expected, message); };

const emitted = new Function(require('../lib/js-compiler')._helperSources.DEQ_HELPER + ';' + src.uq + ';' + src.uqp + ';return { _uq, _uqp, pi: function () { return _uqpI; } };')();
const emittedPair = (a) => { const j = emitted._uqp(a); return j < 0 ? null : [emitted.pi(), j]; };

const M = 0x9e3779b1;
const f64 = new Float64Array(1);
const words = new Uint32Array(f64.buffer);
const colliding = (count) => {
  const out = [];
  for (let k = 1; k <= count; k++) {
    const w1 = (0x3ff00000 + k) >>> 0;
    words[0] = Math.imul(w1, M) >>> 0;
    words[1] = w1;
    out.push(f64[0]);
  }
  return out;
};
const fixture = colliding(4096);
check(fixture.every(Number.isFinite), 'every fixture value is finite');
check(fixture.every((x) => (x | 0) !== x), 'no fixture value takes the int32 hash path');
check(new Set(fixture).size === fixture.length, 'fixture values are pairwise distinct');
check(fixture.every((x) => _uqh(x) === _uqh(fixture[0])), 'fixture values all share one hash');
check(fixture.every((x) => x === x), 'no fixture value is NaN');

const oracle = (arr) => {
  for (let i = 0; i < arr.length - 1; i++) for (let j = i + 1; j < arr.length; j++) if (_deq(arr[i], arr[j])) return [i, j];
  return null;
};
const cloneValue = (x) => (Array.isArray(x) ? Array.from(x, cloneValue) : x !== null && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, cloneValue(v)])) : x);
const agree = (arr, label) => {
  const want = oracle(arr);
  check(allDistinct(arr) === (want === null), `allDistinct ${label}`);
  same(duplicatePair(arr), want, `duplicatePair ${label}`);
  check(emitted._uq(arr) === (want === null), `emitted _uq ${label}`);
  same(emittedPair(arr), want, `emitted _uqp ${label}`);
  return want;
};

{
  const hole = [1, , 3];
  const f1 = () => 1;
  const values = [
    null, true, false, 0, -0, 1, -1, 1.5, NaN, Infinity, -Infinity, 5e-324, '', 'a', 'b', 'ab',
    undefined, f1, () => 1, Symbol('s'), 1n, 2n,
    [], [1], [1, 2], [2, 1], [NaN], [NaN], [undefined], [, ], hole, [1, undefined, 3], [[1]], [[1], []],
    {}, { a: 1 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { a: 2, b: 1 }, { a: NaN }, { a: NaN }, { a: f1 }, { a: () => 1 },
    { a: [1, { x: null }] }, { a: [1, { x: 0 }] }, { a: undefined }, { b: undefined }, { a: 1n }, { a: 2n },
  ];
  const kc = new Map();
  const c = (a, b) => _uqcmp(a, b, kc);
  const sign = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);
  for (const a of values) {
    check(c(a, a) === 0, 'cmp is reflexive');
    for (const b of values) {
      check(sign(c(a, b)) === -sign(c(b, a)), 'cmp is antisymmetric');
      if (_deq(a, b)) check(c(a, b) === 0, `_deq equal values compare 0: ${String(a)} ${String(b)}`);
      for (const d of values) {
        if (c(a, b) <= 0 && c(b, d) <= 0) { checks++; assert.ok(c(a, d) <= 0, 'cmp is transitive'); }
        if (c(a, b) === 0 && c(b, d) === 0) { checks++; assert.ok(c(a, d) === 0, 'cmp equality is transitive'); }
      }
    }
  }
  check(c(NaN, 1) > 0 && c(1, NaN) < 0 && c(NaN, NaN) === 0 && c(0, -0) === 0, 'NaN sorts above numbers, 0 and -0 are one value');
  check(c(undefined, f1) === 0 && c(f1, 1n) === 0, 'undefined, functions and bigints share one rank');
}

{
  const ints = [];
  for (let i = 2; i < 13; i++) ints.push(i);
  const a = [{ k: NaN }, { k: NaN }].concat(ints);
  check(a.length === 13, 'review case has 13 items');
  check(allDistinct(a) === true && duplicatePair(a) === null, 'two separate {k: NaN} among 13 are distinct');
  const nine = [];
  for (let i = 0; i < 20; i++) nine.push({ k: NaN });
  for (const arr of [nine, nine.concat(ints)]) check(allDistinct(arr) === true && duplicatePair(arr) === null, 'separate {k: NaN} objects are all distinct');
  const ref = { k: NaN };
  const r = [ref, ref].concat(ints);
  check(allDistinct(r) === false, 'the same {k: NaN} reference twice is a duplicate');
  same(duplicatePair(r), [0, 1], 'the duplicate pair of a repeated reference');
  const fns = [];
  for (let i = 0; i < 20; i++) fns.push({ a: () => 1 });
  check(allDistinct(fns) === true && duplicatePair(fns) === null, 'separate { a: () => 1 } objects are distinct');
  const fn = () => 1;
  const sharedFn = fns.slice(0, 15).concat([{ a: fn }, { a: fn }]);
  same(duplicatePair(sharedFn), [15, 16], 'the same function reference in two objects is equal');
  const schema = { type: 'array', uniqueItems: true };
  const cg = new Validator(schema);
  const ip = new Validator(schema, { engine: 'interpreter' });
  const m = { exports: {} };
  new Function('module', 'exports', toStandaloneModule(schema, { format: 'cjs' }))(m, m.exports);
  const engines = { codegen: (x) => cg.validate(x).valid, isValidObject: (x) => cg.isValidObject(x), interpreter: (x) => ip.validate(x).valid, standalone: (x) => m.exports.isValid(x) };
  for (const [name, run] of Object.entries(engines)) {
    check(run(a) === true, `${name}: separate {k: NaN} among 13 pass`);
    check(run(nine.concat(ints)) === true, `${name}: twenty separate {k: NaN} pass`);
    check(run(fns) === true, `${name}: separate function-valued members pass`);
    check(run(r) === false, `${name}: the same reference twice fails`);
  }
  const bad = cg.validate(r);
  check(bad.valid === false && bad.errors.length === 1 && bad.errors[0].keyword === 'uniqueItems', 'validate reports uniqueItems for a repeated reference');
  check(JSON.stringify(bad.errors[0]).includes('"i":0') || /items.*(0|1)/.test(bad.errors[0].message), 'the error names the pair');
}

{
  const n = 100000;
  const arr = [];
  for (let i = 0; i < n - 1; i++) arr.push({ id: i % 2 === 0 ? 0 : i });
  arr[1] = { id: 0 };
  Object.defineProperty(arr, n - 1, { get() { throw new Error('the last item was read'); }, enumerable: true, configurable: true });
  check(allDistinct(arr) === false, 'allDistinct stops at the first equal pair');
  check(emitted._uq(arr) === false, 'emitted _uq stops at the first equal pair');
}

{
  let seed = 20260927;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  const hole = () => { const h = [1, , 3]; return h; };
  const sharedRef = { k: NaN };
  const sharedFn = () => 1;
  const nanArrays = [[NaN], [NaN, 1]];
  const base = [
    () => null, () => true, () => 0, () => -0, () => 1, () => 1.5, () => 'a', () => 'b', () => '', () => 7,
    () => [], () => [1], () => [1, 2], () => [2, 1], () => ({}), () => ({ a: 1 }), () => ({ a: 1, b: 2 }), () => ({ b: 2, a: 1 }),
    () => ({ a: [1, { x: null, y: 2 }] }), () => ({ a: [1, { y: 2, x: null }] }), () => ({ a: [1, { x: 0 }] }), () => ({ a: [1, { x: -0 }] }),
    () => ({ k: NaN }), () => sharedRef, () => nanArrays[rnd(2)], () => [NaN], () => ({ a: sharedFn }), () => ({ a: () => 1 }),
    () => sharedFn, () => () => 1, () => hole(), () => [1, undefined, 3], () => ({ u: undefined }), () => ({ b: 1n }),
  ];
  const collide = [
    (k) => fixture[k], (k) => [fixture[k]], (k) => ({ k: fixture[k] }), (k) => ({ k: fixture[k], j: 0 }), (k) => ({ j: 0, k: fixture[k] }),
  ];
  let bucketsOver8 = 0;
  let withPair = 0;
  for (let t = 0; t < 6000; t++) {
    const mix = [0, 0.3, 0.6, 0.9, 1][rnd(5)];
    const span = [3, 6, 9, 12, 40][rnd(5)];
    const shape = rnd(collide.length);
    const len = rnd(3) === 0 ? 10 + rnd(6) : rnd(41);
    const distinct = rnd(2) === 0;
    const arr = [];
    for (let i = 0; i < len; i++) {
      if (rnd(1000) / 1000 < mix) arr.push(collide[distinct ? shape : rnd(collide.length)](distinct ? (i % 40) : rnd(span)));
      else arr.push(base[rnd(base.length)]());
    }
    if (arr.length > 12 && arr.every((x) => x === null || typeof x !== 'object') && arr.some((x) => x !== x)) arr[0] = { z: t };
    if (distinct && rnd(2) === 0 && arr.length > 3) {
      const a = rnd(arr.length), b = rnd(arr.length);
      arr[b] = rnd(2) === 0 ? arr[a] : cloneValue(arr[a]);
    }
    const want = agree(arr, `trial ${t} (length ${arr.length})`);
    if (want !== null) withPair++;
    const counts = new Map();
    for (const x of arr) { const h = _uqh(x); counts.set(h, (counts.get(h) || 0) + 1); }
    if (arr.some((x) => x !== null && typeof x === 'object') && Math.max(0, ...counts.values()) > 8) bucketsOver8++;
  }
  check(bucketsOver8 > 500, `the trials reach buckets past 8 (${bucketsOver8})`);
  check(withPair > 1000 && withPair < 5500, `the trials hold both verdicts (${withPair} with a pair)`);
}

{
  const build = (n, wrap) => {
    let reads = 0;
    const items = [];
    for (let i = 0; i < n; i++) {
      const v = fixture[i];
      if (wrap === 0) { const o = {}; Object.defineProperty(o, 'k', { get() { reads++; return v; }, enumerable: true }); items.push(o); }
      else if (wrap === 1) items.push({ k: v, nest: { k: [v] } });
      else items.push([v]);
    }
    return { items, reads: () => reads };
  };
  const readsFor = (n) => {
    const b = build(n, 0);
    check(allDistinct(b.items) === true, `${n} colliding distinct items are distinct`);
    check(duplicatePair(b.items) === null, `${n} colliding distinct items have no pair`);
    return b.reads();
  };
  const r1 = readsFor(1000), r4 = readsFor(4000);
  check(r4 / r1 < 7, `reads grew ${(r4 / r1).toFixed(1)}x for 4x the items`);
  for (const wrap of [0, 1, 2]) {
    const b = build(4000, wrap);
    const dup = b.items.concat([cloneValue(b.items[1234])]);
    check(allDistinct(dup) === false, `a duplicate among ${dup.length} colliding items is found (shape ${wrap})`);
    same(duplicatePair(dup), [1234, 4000], `its pair (shape ${wrap})`);
  }
  const plain = fixture.slice(0, 4000).map((v) => ({ k: v }));
  const withDup = plain.concat([{ k: fixture[77] }]);
  same(duplicatePair(withDup), [77, 4000], 'the pair among 4001 colliding items');
  same(emittedPair(withDup), [77, 4000], 'the pair among 4001 colliding items, emitted');
  const t0 = process.hrtime.bigint();
  allDistinct(plain); duplicatePair(plain);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check(ms < 2000, `4000 colliding items took ${ms.toFixed(0)} ms`);
  const schema = { type: 'array', uniqueItems: true };
  const cg = new Validator(schema);
  check(cg.validate(plain).valid === true && cg.validate(withDup).valid === false, 'validate on colliding items');
}

assert.strictEqual(checks, EXPECTED_CHECKS, `expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
console.log(`ok: uniqueItems under hash collisions matches the pairwise search on 6000 random arrays and stays near n log n (${checks} checks)`);
