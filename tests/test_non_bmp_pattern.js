'use strict';

// `pattern`, `patternProperties` and `propertyNames` read a pattern as an
// ECMA-262 regular expression in unicode mode (JSON Schema Validation 6.3.3),
// so a character above U+FFFF is one character: `^.$` matches "🐲" and
// `^.{2}$` does not. Every engine was reading UTF-16 code units unless the
// pattern had a `\p{...}` escape (issue #94). A pattern that is valid only
// without the u flag, such as `[\w-.]`, keeps the reading it had.
//
// Checked here: the official suite's optional/non-bmp-regex.json and the
// issue's cases through validate, isValidObject and the buffer path, and the
// linear engine against the platform RegExp on generated patterns and
// strings. scripts/gate.js compares every other path with the Validator on
// the suite file.

const assert = require('assert');
const { Validator } = require('..');
const suite = require('./suite-loader');
const { compileSafe } = require('../lib/safe-regex');

let checks = 0;
const expectAll = (schema, data, valid, label) => {
  const v = new Validator(schema);
  assert.strictEqual(v.validate(structuredClone(data)).valid, valid, `validate: ${label}`);
  assert.strictEqual(v.isValidObject(structuredClone(data)), valid, `isValidObject: ${label}`);
  assert.strictEqual(v.isValid(Buffer.from(JSON.stringify(data))), valid, `isValid(Buffer): ${label}`);
  checks += 3;
};

let suiteCases = 0;
for (const dialect of Object.keys(suite.DIALECTS)) {
  if (!suite.HAVE_SUITE) break;
  for (const g of suite.cases(dialect, { dir: 'optional', only: (f) => f === 'non-bmp-regex.json' })) {
    for (const t of g.tests) { expectAll(g.schema, t.data, t.valid, `${dialect} ${g.description}: ${t.description}`); suiteCases++; }
  }
}
assert.ok(suiteCases >= 60, `only ${suiteCases} suite cases read; is tests/suite checked out?`);

// The issue's cases.
expectAll({ pattern: '^.$' }, '🐲', true, '^.$ on one non-BMP character');
expectAll({ pattern: '^.{2}$' }, '🐲', false, '^.{2}$ on one non-BMP character');
expectAll({ pattern: '^🐲*$' }, '', true, 'a repeated non-BMP literal, none');
expectAll({ pattern: '^🐲*$' }, '🐲🐲', true, 'a repeated non-BMP literal, two');
expectAll({ patternProperties: { '^🐲*$': { type: 'integer' } } }, { '🐲🐲': 'x' }, false, 'patternProperties with a non-BMP literal');
expectAll({ maxLength: 1, pattern: '^.$' }, '🐲', true, 'maxLength and pattern agree on one character');
expectAll({ propertyNames: { pattern: '^.$' } }, { '🐲': 1 }, true, 'propertyNames on a non-BMP name');
expectAll({ pattern: '^[^a]$' }, '🐲', true, 'a negated class takes the whole character');
expectAll({ pattern: '^\\S$' }, '🐲', true, '\\S takes the whole character');
expectAll({ pattern: '^[🐲a]+$' }, 'a🐲a', true, 'a non-BMP character inside a class');
expectAll({ pattern: '^\\ud83d\\udc32$' }, '🐲', true, 'a surrogate pair written as two escapes is one character');
expectAll({ pattern: '^.$' }, '\ud83d', true, 'a lone surrogate is one character');
// Valid only without the u flag: read by code unit, as before.
expectAll({ pattern: '^[\\w-.]+$' }, 'a-b.', true, 'a pattern valid only without the u flag still works');
expectAll({ pattern: '^\\-.$' }, '-🐲', false, 'a pattern valid only without the u flag reads code units');

// The linear engine against the platform RegExp in unicode mode.
let x = 88172645;
const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ATOMS = ['a', '.', '🐲', '😀', '\\S', '\\s', '\\w', '\\W', '[^a]', '[a🐲]', '[^🐲]', '[😀-🐲]', '(?:🐲|a)', '(a|.)'];
const QUANTIFIERS = ['', '', '?', '*', '+', '{2}', '{1,3}'];
const CHARS = ['a', 'b', '🐲', '😀', '\ud83d', '\udc32', ' ', '\n', 'é'];
let engineChecks = 0;
for (let k = 0; k < 4000; k++) {
  let p = rnd() < 0.6 ? '^' : '';
  const n = 1 + Math.floor(rnd() * 4);
  for (let j = 0; j < n; j++) p += pick(ATOMS) + pick(QUANTIFIERS);
  if (rnd() < 0.6) p += '$';
  let re; try { re = new RegExp(p, 'u'); } catch { continue; }
  const safe = compileSafe(p);
  for (let t = 0; t < 8; t++) {
    let s = '';
    const m = Math.floor(rnd() * 6);
    for (let j = 0; j < m; j++) s += pick(CHARS);
    assert.strictEqual(safe.test(s), re.test(s), `${JSON.stringify(p)} on ${JSON.stringify(s)}`);
    engineChecks++;
  }
}

console.log(`ok: ${suiteCases} suite cases and the issue's through three entry points (${checks} checks), ${engineChecks} linear engine answers equal to RegExp with the u flag`);
