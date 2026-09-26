'use strict';

// `ipv6` accepts the uncompressed eight-group form with one regular expression
// before it walks the string. That shortcut may only ever say yes to something
// the walk says yes to. This checks it one way, as test_uri_fast_path does for
// uri: every string the expression accepts must be an address to the walk,
// the function and a compiled validator, and the validator's answer must match
// the function's on everything else too.

const assert = require('assert');
const formats = require('../lib/formats');
const { Validator } = require('..');

let walk = null;
try {
  // eslint-disable-next-line no-new-func
  walk = new Function('d', formats.ipv6Source('d', true) + ';return true');
} catch (e) {
  if (!/call to Function|code generation/i.test(String(e && e.message))) throw e;
  console.log('skip: code generation is blocked');
  process.exit(0);
}
const compiled = new Validator({ type: 'string', format: 'ipv6' });
for (let i = 0; i < 3; i++) compiled.isValidObject('::1');
const withErrors = new Validator({ type: 'object', properties: { a: { type: 'string', format: 'ipv6' } } });

let x = 0x1234567;
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k; };
const A = '0123456789abcdefABCDEFg:.%/ ';
const groups = ['0', '1', 'ffff', 'FFFF', '0db8', '12345', '', 'g', '0:0', '1.2.3.4', 'fe80'];
let checked = 0, fast = 0, bad = 0;
for (let k = 0; k < 300000; k++) {
  let s;
  const kind = rnd(3);
  if (kind === 0) {
    // Eight groups of one to four hex digits, occasionally broken by one bad
    // group, so the fast path's own boundary is exercised from both sides.
    const H = '0123456789abcdefABCDEF';
    const p = [];
    for (let i = 0; i < 8; i++) { let g = ''; const n = 1 + rnd(4); for (let j = 0; j < n; j++) g += H[rnd(H.length)]; p.push(g); }
    if (rnd(4) === 0) p[rnd(8)] = groups[rnd(groups.length)];
    s = p.join(':');
  } else if (kind === 1) {
    const m = 6 + rnd(4);
    const p = [];
    for (let i = 0; i < m; i++) p.push(groups[rnd(groups.length)]);
    s = p.join(':');
  } else {
    s = '';
    const n = rnd(42);
    for (let i = 0; i < n; i++) s += A[rnd(A.length)];
  }
  checked++;
  const byFunction = formats.ipv6(s);
  if (formats.IPV6_FULL.test(s)) {
    fast++;
    if (!walk(s) && bad++ < 10) console.error(`fast path accepts ${JSON.stringify(s)}, the walk does not`);
  }
  if (byFunction !== walk(s) && bad++ < 10) console.error(`function ${byFunction}, walk ${walk(s)} on ${JSON.stringify(s)}`);
  if (compiled.isValidObject(s) !== byFunction && bad++ < 10) console.error(`compiled disagrees on ${JSON.stringify(s)}`);
  if (withErrors.validate({ a: s }).valid !== byFunction && bad++ < 10) console.error(`error path disagrees on ${JSON.stringify(s)}`);
}
assert.strictEqual(bad, 0, `${bad} disagreements`);
assert.ok(fast > 3000, `the fast path matched only ${fast} strings`);
console.log(`ok: ipv6 fast path is a subset of the walk, ${fast} fast accepts among ${checked} strings`);
