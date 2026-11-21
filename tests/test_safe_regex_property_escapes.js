'use strict';

const assert = require('node:assert');
const { Validator } = require('..');
const { compileSafe, patternIsSafe } = require('../lib/safe-regex');

const CASES = [
  ['^\\p{L}+$', ['abc', 'éçş', '日本語', '𝐀𝐁'], ['', '123', 'a1', ' ']],
  ['^\\P{L}+$', ['123', '---', ' 1!'], ['', 'a', 'é', '𝐀']],
  ['^[\\p{L}\\d_]+$', ['a1_é𝐀'], ['', 'a-1', ' ']],
  ['^[^\\p{L}]+$', ['123!'], ['', 'a', 'é', '𝐀']],
  ['^\\p{Lu}\\p{Ll}*$', ['Hello', 'Çş', '𝐀a'], ['hello', 'çş', '123']],
  ['^\\p{Script=Greek}+$', ['αβγΩ'], ['abc', 'αa']],
  ['^\\p{Nd}+$' , ['0123', '٠١٢٣'], ['abc', '1a']],
  ['^a\\cJb$', ['a\nb'], ['ab', 'a\\cJb']],
  ['^[\\cA-\\cC]+$', ['\x01\x02\x03'], ['\x04', 'A']],
];

for (const [pat, good, bad] of CASES) {
  assert.strictEqual(patternIsSafe(pat), true, `patternIsSafe(${JSON.stringify(pat)})`);
  const safe = compileSafe(pat);
  const ref = new RegExp(pat, 'u');
  for (const s of good) {
    assert.strictEqual(safe.test(s), true, `${pat} should match ${JSON.stringify(s)}`);
    assert.strictEqual(safe.test(s), ref.test(s), `${pat} should match RegExp on ${JSON.stringify(s)}`);
  }
  for (const s of bad) {
    assert.strictEqual(safe.test(s), false, `${pat} should reject ${JSON.stringify(s)}`);
    assert.strictEqual(safe.test(s), ref.test(s), `${pat} should match RegExp on ${JSON.stringify(s)}`);
  }
}

// Nested quantifier around \p{L} must run in linear time on both engines.
const hostile = '^(\\p{L}+)+$';
assert.strictEqual(patternIsSafe(hostile), true);
for (const opts of [{}, { engine: 'interpreter' }]) {
  const v = new Validator({ type: 'string', pattern: hostile }, opts);
  const t0 = Date.now();
  assert.strictEqual(v.validate('é'.repeat(40) + '!').valid, false);
  assert.strictEqual(v.validate('é'.repeat(2000) + '!').valid, false);
  assert.strictEqual(v.validate('é'.repeat(2000)).valid, true);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `hostile \\p{L} pattern took ${ms} ms (${JSON.stringify(opts)})`);
}

// Patched RegExp.prototype.exec must not be invoked by the safe regex matcher.
const matcher = compileSafe('^\\p{L}+$');
const origExec = RegExp.prototype.exec;
let patchedCalled = false;
RegExp.prototype.exec = function () { patchedCalled = true; return origExec.apply(this, arguments); };
try {
  assert.strictEqual(matcher.test('é𝐀'), true);
  assert.strictEqual(matcher.test('é1'), false);
  assert.strictEqual(patchedCalled, false, 'patched RegExp.prototype.exec should not be called');
} finally {
  RegExp.prototype.exec = origExec;
}

// Invalid / malformed property escapes and \c are still refused.
for (const bad of ['^\\p{NoSuchProperty}$', '^\\p{$', '^\\p$', '^[\\c]$', '^\\c1$']) {
  assert.strictEqual(patternIsSafe(bad), false, `malformed ${JSON.stringify(bad)} must be refused`);
}

console.log('ok: safe-regex handles \\p{...}, \\P{...}, and \\cX in linear time without backtracking');
