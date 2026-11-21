'use strict';

const assert = require('node:assert');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build');
const { multipleOfOk } = require('../lib/multiple-of');

const CASES = [
  [1e20, 3, false],
  [3e20, 3, true],
  [1e308, 0.5, true],
  [-1e308, 0.5, true],
  [1e308, 0.123456789, false],
  [0.30000000000000004, 0.1, false],
  [0.3, 0.1, true],
  [0.0075, 0.0001, true],
  [0.00751, 0.0001, false],
  [4e-8, 1e-8, true],
  [1.5e-8, 1e-8, false],
  [0, 0.1, true],
  [-0, 0.1, true],
  [1, 0.1, true],
  [1, 0.3, false],
  [9007199254740992, 2, true],
  [9007199254740992, 3, false],
  [1e-300, 1e-300, true],
  [1e-300, 3e-300, false],
  [6e-300, 3e-300, true],
  [5e-324, 5e-324, true],
  [1e-323, 5e-324, true],
  [1e21, 7, false],
  [7e21, 7, true],
  [10, 0, false],
  [NaN, 1, false],
];

for (const [value, divisor, expected] of CASES) {
  assert.strictEqual(multipleOfOk(value, divisor), expected, `direct multipleOfOk(${value}, ${divisor})`);
  if (!Number.isFinite(value) || divisor === 0) continue;
  for (const schema of [{ multipleOf: divisor }, { type: 'number', multipleOf: divisor }, { type: 'object', properties: { n: { type: 'number', multipleOf: divisor } }, required: ['n'] }]) {
    const doc = schema.properties ? { n: value } : value;
    const cg = new Validator(schema);
    const ip = new Validator(schema, { engine: 'interpreter' });
    assert.strictEqual(cg.validate(doc).valid, expected, `codegen ${JSON.stringify(schema)} on ${value}`);
    assert.strictEqual(cg.isValidObject(doc), expected, `isValidObject ${JSON.stringify(schema)} on ${value}`);
    assert.strictEqual(ip.validate(doc).valid, expected, `interpreter ${JSON.stringify(schema)} on ${value}`);
    const m = { exports: {} };
    new Function('module', 'exports', toStandaloneModule(schema, { format: 'cjs' }))(m, m.exports);
    assert.strictEqual(m.exports.isValid(doc), expected, `standalone ${JSON.stringify(schema)} on ${value}`);
  }
}

// Independent decimal reference over 20,000 pseudo-random pairs.
let seed = 0x1234567;
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
const toRat = (x) => {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(Math.abs(x)));
  const frac = m[2] || '';
  const exp = (m[3] ? Number(m[3]) : 0) - frac.length;
  return [BigInt(m[1] + frac), exp];
};
const refOk = (d, m) => {
  if (!Number.isFinite(d) || !Number.isFinite(m) || m === 0) return false;
  const [da, ea] = toRat(d), [db, eb] = toRat(m);
  const k = Math.min(ea, eb);
  return (da * 10n ** BigInt(ea - k)) % (db * 10n ** BigInt(eb - k)) === 0n;
};

for (let i = 0; i < 20000; i++) {
  const mode = next() % 4;
  let d, m;
  if (mode === 0) {
    m = (next() % 1000) + 1;
    d = (next() % 2 === 0 ? m * (next() % 100000) : (next() % 1000000)) * (next() % 2 ? 1 : -1);
  } else if (mode === 1) {
    const exp = (next() % 40) - 20;
    m = Number(`${(next() % 99) + 1}e${exp}`);
    d = Number(`${(next() % 9999) + 1}e${exp + (next() % 5) - 2}`);
  } else if (mode === 2) {
    m = Number(`${(next() % 9) + 1}e${(next() % 10) - 5}`);
    d = Number(`${(next() % 9) + 1}e${20 + (next() % 280)}`);
  } else {
    const buf = new ArrayBuffer(8);
    const u32 = new Uint32Array(buf);
    const f64 = new Float64Array(buf);
    u32[0] = next(); u32[1] = next();
    d = f64[0];
    u32[0] = next(); u32[1] = next();
    m = f64[0];
  }
  if (!Number.isFinite(d) || !Number.isFinite(m) || m === 0) continue;
  assert.strictEqual(multipleOfOk(d, m), refOk(d, m), `random pair (${d}, ${m})`);
}

console.log('ok: exact decimal multipleOf matches across engines and 20000 random pairs');
