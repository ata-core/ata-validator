'use strict';

// Each single-pass predicate is checked against the regular-expression form it
// replaces, on a hand-picked set and on random strings over the alphabet the
// regular expression cares about plus a non-ASCII digit. The old forms are
// kept here, not imported, so the test keeps meaning after they are gone.
const assert = require('node:assert');
const F = require('../lib/formats');

const OLD = {
  date: (s) => { if (s.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const m = +s.slice(5, 7), d = +s.slice(8, 10); return m >= 1 && m <= 12 && d >= 1 && d <= 31; },
  ipv4: (s) => { const p = s.split('.'); return p.length === 4 && p.every((n) => { const v = +n; return n !== '' && v >= 0 && v <= 255 && String(v) === n; }); },
};

const PICKED = {
  date: ['2026-08-28', '1999-12-31', '2000-01-01', '2026-13-01', '2026-00-10', '2026-08-00', '2026-08-32', '2026-08-3', 'abcd-ef-gh', '٢026-08-28', '2026-08-28 ', ''],
  ipv4: ['0.0.0.0', '255.255.255.255', '256.0.0.0', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.', '.1.2.3', 'a.b.c.d', '1.2.3.4 ', '', '1..2.3', '0.0.0.00', '1.2.3.4e'],
};
const ALPHABET = { date: '0123456789-x٢', ipv4: '0123456789.x' };
const LENGTHS = { date: [10, 9, 11], ipv4: [7, 15, 3, 16, 8, 12] };

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

for (const name of ['date', 'ipv4']) {
  for (const s of PICKED[name]) assert.strictEqual(F[name](s), OLD[name](s), `${name} picked: ${JSON.stringify(s)}`);
  let n = 0;
  for (let i = 0; i < 200000; i++) {
    const len = LENGTHS[name][i % LENGTHS[name].length];
    let s = ''; for (let j = 0; j < len; j++) s += ALPHABET[name][Math.floor(rnd() * ALPHABET[name].length)];
    if (F[name](s) !== OLD[name](s)) { n++; if (n < 4) console.log(`  mismatch ${name}: ${JSON.stringify(s)} new=${F[name](s)} old=${OLD[name](s)}`); }
  }
  assert.strictEqual(n, 0, `${name}: ${n} fuzz mismatches`);
  // The generated source must be the same predicate.
  const fn = new Function('v', F[name + 'Source']('v', true) + ';return true');
  for (const s of PICKED[name]) assert.strictEqual(fn(s), OLD[name](s), `${name} source form: ${JSON.stringify(s)}`);
  console.log(`ok: ${name} single-pass agrees with the regular expression`);
}
console.log('ok: formats single pass');
