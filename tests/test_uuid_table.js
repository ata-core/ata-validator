'use strict';
// The uuid check reads two class tables (lib/formats.js, and the hoisted
// `_uu` the generator emits from lib/formats-source.js) instead of branching on
// every character. The three forms, runtime, hoisted and inline, must agree
// with each other and with the rule, 8-4-4-4-12 hexadecimal digits in either
// case, for every code point at every position, so a table entry can never
// let a character through that the rule refuses.
const assert = require('assert');
const formats = require('../lib/formats');
const source = require('../lib/formats-source');

const hoisted = new Function(source.uuidHelperSource('_uu') + ';return _uu')();
const inline = new Function('_s', `if(typeof _s!=='string')return false;${source.uuidSource('_s', true)}return true`);
const rule = (s) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);

const base = '123e4567-e89b-12d3-a456-426614174000';
assert.ok(formats.uuid(base) && hoisted(base) && inline(base));
assert.ok(formats.uuid(base.toUpperCase()) && hoisted(base.toUpperCase()) && inline(base.toUpperCase()));

let checked = 0;
for (let pos = 0; pos < 36; pos++) {
  for (let c = 0; c < 0x10000; c++) {
    const s = base.slice(0, pos) + String.fromCharCode(c) + base.slice(pos + 1);
    const want = rule(s);
    if (formats.uuid(s) !== want) assert.fail(`runtime uuid: position ${pos} code point ${c}: ${formats.uuid(s)} against ${want}`);
    if (hoisted(s) !== want) assert.fail(`hoisted _uu: position ${pos} code point ${c}: ${hoisted(s)} against ${want}`);
    if (inline(s) !== want) assert.fail(`inline uuidSource: position ${pos} code point ${c}: ${inline(s)} against ${want}`);
    checked++;
  }
}
for (const s of ['', base.slice(1), base + '0', base.replace(/-/g, ''), '{' + base + '}', 'urn:uuid:' + base]) {
  assert.strictEqual(formats.uuid(s), false, s);
  assert.strictEqual(hoisted(s), false, s);
  assert.strictEqual(inline(s), false, s);
}
console.log(`ok: uuid tables agree with the rule on ${checked} single-character substitutions and 6 wrong shapes`);
