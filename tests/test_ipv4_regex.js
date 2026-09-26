'use strict';

// `ipv4` answers with one regular expression; ipv4Range walks the same
// language character by character and still serves the IPv6 embedded form.
// The two must agree on every string, not only on the ones the regex accepts,
// so this compares both directions: octet shapes crossed at the boundaries
// (0, leading zeros, 199/200, 249/250, 255/256, four digits), wrong counts of
// octets and dots, and random strings over the characters that matter.

const assert = require('assert');
const formats = require('../lib/formats');
const { Validator } = require('..');

const walk = (s) => formats.ipv4Range(s, 0, s.length);
const compiled = new Validator({ type: 'string', format: 'ipv4' });
for (let i = 0; i < 3; i++) compiled.isValidObject('1.1.1.1'); // past tier 0, onto generated code

let checked = 0, valid = 0, bad = 0;
function check (s) {
  checked++;
  const want = walk(s);
  if (want) valid++;
  const a = formats.ipv4(s), b = compiled.isValidObject(s);
  if ((a !== want || b !== want) && bad++ < 10) {
    console.error(`${JSON.stringify(s)}: walk ${want}, regex ${a}, compiled ${b}`);
  }
}

const octets = ['0', '00', '01', '001', '1', '9', '10', '99', '100', '199', '200', '249', '250', '255', '256', '299', '300', '999', '1000', ''];
for (const a of octets) for (const b of ['0', '255', '01']) for (const c of ['1', '256']) for (const d of octets) {
  check([a, b, c, d].join('.'));
  check([a, b, c].join('.'));
  check([a, b, c, d, '1'].join('.'));
  check([a, b, c, d].join('.') + '.');
  check('.' + [a, b, c, d].join('.'));
}

let x = 0x9e3779b9;
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k; };
const A = '0123456789.:a /-\n';
for (let k = 0; k < 300000; k++) {
  let s;
  if (rnd(2)) {
    const parts = [];
    const m = 3 + rnd(3);
    for (let i = 0; i < m; i++) parts.push(octets[rnd(octets.length)]);
    s = parts.join('.');
  } else {
    s = '';
    const n = rnd(18);
    for (let i = 0; i < n; i++) s += A[rnd(A.length)];
  }
  check(s);
}

assert.strictEqual(bad, 0, `${bad} strings where the ipv4 regex and the walk disagree`);
// Agreement over strings that are all invalid would prove little.
assert.ok(valid > 4000, `only ${valid} valid addresses among ${checked} strings`);
console.log(`ok: ipv4 regex agrees with the walk on ${checked} strings, ${valid} of them valid`);
