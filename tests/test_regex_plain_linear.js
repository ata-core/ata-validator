'use strict';

// The interpreted engine gives a pattern to the platform RegExp when
// plainLinear accepts it (lib/interpreter-core.js). Two things must hold for
// every pattern it accepts: the code generator also gives it a RegExp
// (nativeIsLinear in lib/regex-linear.js), so the two engines answer with the
// same matcher, and the RegExp answers as the linear engine does, which the
// interpreted engine used before. Patterns come from the official test suite
// and from a seeded generator; the strings from a seeded generator too.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { _plainLinear: plainLinear } = require('../lib/interpreter-core');
const { nativeIsLinear } = require('../lib/regex-linear');
const { compileSafe } = require('../lib/safe-regex');

let x = 2463534242;
const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const patterns = new Set();
const walk = (o) => {
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    if (k === 'pattern' && typeof o[k] === 'string') patterns.add(o[k]);
    if (k === 'patternProperties' && o[k] && typeof o[k] === 'object') for (const p of Object.keys(o[k])) patterns.add(p);
    walk(o[k]);
  }
};
const suite = path.join(__dirname, 'suite', 'tests');
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : []);
if (fs.existsSync(suite)) for (const f of files(suite)) walk(JSON.parse(fs.readFileSync(f, 'utf8')));

const ATOMS = ['a', 'b', '.', '\\d', '\\w', '\\s', '\\D', '\\W', '\\S', '\\.', '\\-', '\\^', '\\$', '[a-z]', '[^a]', '[\\d]', '[\\w-]', '[\\W]', '[^\\S]', '[\\D\\d]', '[.]', '[\\]]', '[-a]', '[^]', '[]', '[^^]', '[a^]', '[0-9]', '\\b', '\\u0041', '\\x41', '/', ':', 'é', '\ud83d', '[\ud83d]', '(a)', 'a|b', '(?:a)'];
const QUANTIFIERS = ['', '', '', '?', '*', '+', '{2}', '{1,3}', '{0,64}', '{65}', '{2,}', '*?', '+?', '??', '{3,1}', '{1000}'];
for (let k = 0; k < 200000; k++) {
  let p = rnd() < 0.5 ? '^' : '';
  const n = 1 + Math.floor(rnd() * 5);
  for (let j = 0; j < n; j++) p += pick(ATOMS) + pick(QUANTIFIERS);
  if (rnd() < 0.5) p += '$';
  patterns.add(p);
}

const CHARS = ['a', 'b', 'z', 'A', '0', '5', '9', '-', '.', ' ', '\t', '\n', '\r', ' ', ' ', '　', '﻿', '_', ':', '/', 'é', '😀', ']', '^', '$', '\\'];
let accepted = 0, checks = 0;
for (const p of patterns) {
  if (!plainLinear(p)) continue;
  accepted++;
  assert.ok(nativeIsLinear(p), `plainLinear accepts ${JSON.stringify(p)}, which the code generator gives the linear engine`);
  const re = new RegExp(p);
  const safe = compileSafe(p);
  for (let t = 0; t < 12; t++) {
    let s = '';
    const n = Math.floor(rnd() * 8);
    for (let j = 0; j < n; j++) s += pick(CHARS);
    checks++;
    assert.strictEqual(re.test(s), safe.test(s), `${JSON.stringify(p)} on ${JSON.stringify(s)}`);
  }
}
assert.ok(accepted > 5000, `only ${accepted} generated patterns accepted; the generator no longer exercises the rule`);

for (const p of ['[0-9]', '^[0-9]{5}$', '^[a-z]+$', '^\\d{3}-\\d{4}$', '^.{1,10}$', '^[^\\s]a*$']) assert.strictEqual(plainLinear(p), true, p);
for (const p of ['[^]', '[]', '[\\S]', '[\ud83d]', '\ud83d', '(a)', 'a|b', '[a-z]+', '^a+b+$', '^a+?$', 'a{2,}', 'a{0,64}b?', '\\bword', 'a?b?c?d?e?f?g?']) assert.strictEqual(plainLinear(p), false, p);

console.log(`ok: ${accepted} patterns on the platform RegExp, all also native in generated code, ${checks} answers equal to the linear engine`);
