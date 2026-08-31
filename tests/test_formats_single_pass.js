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

// date-time is not fuzzed against the form it replaced: that one asked
// `Date.parse` whether the string was a date, and V8's parser rolls a bad day
// into the next month, so it accepted 2026-02-30 and 2026-02-29. The reference
// below spells out RFC 3339 instead, and the picked cases pin the four answers
// that changed.
function referenceDateTime (s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return false;
  const year = +m[1], month = +m[2], day = +m[3];
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > days) return false;
  if (+m[4] > 23 || +m[5] > 59 || +m[6] > 59) return false;
  const off = m[8];
  if (off === 'Z' || off === 'z') return true;
  return +off.slice(1, 3) <= 23 && +off.slice(4, 6) <= 59;
}

const DATE_TIME_PICKED = [
  ['2026-08-31T12:00:00Z', true],
  ['2026-08-31t12:00:00z', true],
  ['2026-08-31T12:00:00.123456Z', true],
  ['2026-08-31T12:00:00+02:00', true],
  ['2026-08-31T12:00:00-05:30', true],
  ['2024-02-29T00:00:00Z', true],
  ['2000-02-29T00:00:00Z', true],
  // Accepted before, because Date.parse rolls these over rather than refusing
  ['2026-02-29T00:00:00Z', false],
  ['1900-02-29T00:00:00Z', false],
  ['2026-02-30T00:00:00Z', false],
  ['2026-12-31T24:00:00Z', false],
  // Refused before and now
  ['2026-13-01T00:00:00Z', false],
  ['2026-00-10T00:00:00Z', false],
  ['2026-12-31T23:60:00Z', false],
  ['2026-12-31T23:59:60Z', false],
  ['2026-08-31T12:00:00+24:00', false],
  ['2026-08-31T12:00:00+02:60', false],
  ['2026-08-31T12:00:00', false],
  ['2026-08-31 12:00:00Z', false],
  ['2026-08-31T12:00:00.Z', false],
  ['2026-08-31T12:00:00ZZ', false],
  ['2026-08-31T12:00:00+0200', false],
  ['2026-8-31T12:00:00Z', false],
  ['', false],
];

for (const [value, expected] of DATE_TIME_PICKED) {
  assert.strictEqual(F.dateTime(value), expected, `date-time picked: ${JSON.stringify(value)}`);
  assert.strictEqual(referenceDateTime(value), expected, `date-time reference: ${JSON.stringify(value)}`);
}

{
  const dtAlphabet = '0123456789-:.TtZz+ ';
  let n = 0;
  for (let i = 0; i < 300000; i++) {
    const len = [20, 19, 21, 24, 25, 29][i % 6];
    let v = '';
    for (let j = 0; j < len; j++) v += dtAlphabet[Math.floor(rnd() * dtAlphabet.length)];
    // Mostly-shaped strings, so the fuzz spends its time near the boundary
    if (i % 3 === 0) {
      const y = 1800 + Math.floor(rnd() * 400);
      const mo = String(Math.floor(rnd() * 14)).padStart(2, '0');
      const d = String(Math.floor(rnd() * 33)).padStart(2, '0');
      const h = String(Math.floor(rnd() * 26)).padStart(2, '0');
      const mi = String(Math.floor(rnd() * 62)).padStart(2, '0');
      const se = String(Math.floor(rnd() * 62)).padStart(2, '0');
      const tail = ['Z', 'z', '+02:00', '-05:30', '+25:00', '+02:61', '', '.5Z'][Math.floor(rnd() * 8)];
      v = `${y}-${mo}-${d}T${h}:${mi}:${se}${tail}`;
    }
    if (F.dateTime(v) !== referenceDateTime(v)) {
      n++;
      if (n < 4) console.log(`  mismatch date-time: ${JSON.stringify(v)} new=${F.dateTime(v)} ref=${referenceDateTime(v)}`);
    }
  }
  assert.strictEqual(n, 0, `date-time: ${n} fuzz mismatches`);

  const fn = new Function('v', F.dateTimeSource('v', true) + ';return true');
  for (const [value, expected] of DATE_TIME_PICKED) {
    assert.strictEqual(fn(value), expected, `date-time source form: ${JSON.stringify(value)}`);
  }
  console.log('ok: date-time single-pass agrees with RFC 3339');
}

console.log('ok: formats single pass');
