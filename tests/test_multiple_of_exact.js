'use strict';

const assert = require('node:assert');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build');
const { multipleOfOk } = require('../lib/multiple-of');

const EXPECTED_CHECKS = 20435;
// Every assert goes through check(), so the final count shows the test ran
// the checks it names and did not pass by doing nothing.
let checks = 0;
const check = (actual, expected, message) => { checks++; assert.strictEqual(actual, expected, message); };

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
  check(multipleOfOk(value, divisor), expected, `direct multipleOfOk(${value}, ${divisor})`);
  if (!Number.isFinite(value) || divisor === 0) continue;
  for (const schema of [{ multipleOf: divisor }, { type: 'number', multipleOf: divisor }, { type: 'object', properties: { n: { type: 'number', multipleOf: divisor } }, required: ['n'] }]) {
    const doc = schema.properties ? { n: value } : value;
    const cg = new Validator(schema);
    const ip = new Validator(schema, { engine: 'interpreter' });
    check(cg.validate(doc).valid, expected, `codegen ${JSON.stringify(schema)} on ${value}`);
    check(cg.isValidObject(doc), expected, `isValidObject ${JSON.stringify(schema)} on ${value}`);
    check(ip.validate(doc).valid, expected, `interpreter ${JSON.stringify(schema)} on ${value}`);
    const m = { exports: {} };
    new Function('module', 'exports', toStandaloneModule(schema, { format: 'cjs' }))(m, m.exports);
    check(m.exports.isValid(doc), expected, `standalone ${JSON.stringify(schema)} on ${value}`);
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
  checks++;
  assert.strictEqual(multipleOfOk(d, m), refOk(d, m), `random pair (${d}, ${m})`);
}

// The standalone module a schema with multipleOf builds still imports nothing:
// the helper is written into it.
for (const format of ['cjs', 'esm']) {
  const src = toStandaloneModule({ type: 'number', multipleOf: 0.1 }, { format });
  check(/\brequire\(|^\s*import\b/m.test(src), false, `standalone ${format} module imports nothing`);
}

// ata-validator/kernels and the backends of ata-validator/ir. The closure
// backend and the kernel module reach no CommonJS file, so they carry their own
// copy of lib/multiple-of.js (lib/kernels/multiple-of.mjs); these runs hold the
// copies to the same answers. Values from the review: 1e20 for 3 and
// 0.30000000000000004 for 0.1 are not multiples, 1e308 for 0.5 is.
async function backends() {
  const { closureModule } = await import('../lib/ir/closures.mjs');
  const { specialize, functionBody } = await import('../lib/ir/emit.mjs');
  const K = await import('../lib/kernels/index.mjs');
  const loadClosure = (src) => {
    const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(src);
    assert.ok(m, 'closure module starts with its import');
    return new Function('K', `const {${m[1]}}=K\n` + src.slice(m[0].length).replace(/^export const\{isValid,validate\}=/m, 'const{isValid,validate}=') + 'return{isValid,validate}')(K);
  };
  const loadEmitted = (src) => new Function('K', functionBody(src))(K);
  for (const [value, divisor, expected] of CASES) {
    if (!Number.isFinite(value) || divisor === 0) continue;
    const schema = { multipleOf: divisor };
    check(K.mok(value, divisor), expected, `kernels mok(${value}, ${divisor})`);
    const c = closureModule(schema, { richErrors: false, useDefaults: false });
    assert.ok(c !== null, 'closureModule takes {multipleOf}');
    const closure = loadClosure(c);
    check(closure.isValid(value), expected, `closure isValid ${value} % ${divisor}`);
    check(closure.validate(value).valid, expected, `closure validate ${value} % ${divisor}`);
    for (const richErrors of [false, true]) {
      const emitted = loadEmitted(specialize(schema, { verdict: true, richErrors, useDefaults: false }));
      check(emitted.isValid(value), expected, `emitted module (richErrors ${richErrors}) ${value} % ${divisor}`);
    }
  }
}

backends().then(() => {
  assert.strictEqual(checks, EXPECTED_CHECKS, `expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
  console.log(`ok: exact decimal multipleOf matches across engines, the closure backend, the kernels and 20000 random pairs (${checks} checks)`);
}, (e) => { console.error(e); process.exit(1); });
