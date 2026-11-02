'use strict';
// The email local part and every hostname label are checked one character at a
// time against a mask: four 32-bit words, picked by range and read with `>>>`
// (maskSource in lib/formats-source.js). A wrong bit lets a character through
// that the rule refuses, so this file holds the masks to their definitions
// two ways: every code point at positions inside a real address, and generated
// addresses through the emitted check against the runtime one in lib/formats.js.
const assert = require('assert');
const formats = require('../lib/formats');
const source = require('../lib/formats-source');

const emitted = (src) => new Function('_s', `if(typeof _s!=='string')return false;${src('_s', true)}return true`);
const email = emitted(source.emailSource);
const hostname = emitted(source.hostnameSource);

// RFC 5322 atext plus the dot, and an LDH hostname label character.
const isLocal = (c) => /[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]/.test(String.fromCharCode(c));
const isHost = (c) => /[A-Za-z0-9-]/.test(String.fromCharCode(c));

// The address the sweeps vary: a local part and a domain long enough that a
// substituted character sits away from the edges the other rules guard.
const base = 'first.last@mail.example.com';
const at = base.indexOf('@');
let checked = 0;
for (let c = 0; c < 0x10000; c++) {
  const ch = String.fromCharCode(c);
  // Middle of the local part: the dot rule needs neighbours that are not dots.
  for (const pos of [2, 7]) {
    const s = base.slice(0, pos) + ch + base.slice(pos + 1);
    const want = c === 64 ? false : isLocal(c);
    assert.strictEqual(email(s), want, `emitted email, local position ${pos}, code point ${c}`);
    assert.strictEqual(formats.email(s), want, `runtime email, local position ${pos}, code point ${c}`);
    checked += 2;
  }
  // Middle of a domain label, where a hyphen is allowed.
  for (const pos of [at + 3, at + 8]) {
    const s = base.slice(0, pos) + ch + base.slice(pos + 1);
    const want = c === 46 || isHost(c);
    assert.strictEqual(email(s), want, `emitted email, domain position ${pos}, code point ${c}`);
    const host = s.slice(at + 1);
    assert.strictEqual(hostname(host), want, `emitted hostname, code point ${c}`);
    assert.strictEqual(formats.hostname(host), want, `runtime hostname, code point ${c}`);
    checked += 3;
  }
}

// Generated addresses, half of them altered by one character, through the
// emitted check and the runtime one. Counted both ways so a generator that
// only produces rejections cannot pass for agreement.
let seed = 987654321;
const rnd = (k) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % k; };
const pick = (a) => a[rnd(a.length)];
const atext = "abcxyzABCXYZ0189!#$%&'*+-/=?^_`{|}~";
const word = () => { let s = ''; const n = 1 + rnd(rnd(4) ? 8 : 70); for (let i = 0; i < n; i++) s += pick(atext); return s; };
const qchar = () => rnd(6) ? pick(' !#$@,;:<>[]().abcXYZ09~') : '\\' + pick(' "\\a~');
const label = () => { const n = 1 + rnd(rnd(5) ? 10 : 66); let s = ''; for (let i = 0; i < n; i++) s += (i === 0 || i === n - 1) ? pick('aZ09') : pick('aZ09--'); return s; };
const v4 = () => [0, 0, 0, 0].map(() => pick(['0', '9', '99', '255', '256', '25', String(rnd(300))])).join('.');
const local = () => rnd(4) ? Array.from({ length: 1 + rnd(3) }, word).join('.') : '"' + Array.from({ length: rnd(12) }, qchar).join('') + '"';
const domain = () => {
  const r = rnd(10);
  if (r === 0) return '[' + v4() + ']';
  if (r === 1) return '[' + pick(['IPv6:', 'ipv6:', 'IPv4:']) + pick(['::1', '1:2:3:4:5:6:7:8', '1::', '1:2::3:4', '::ffff:' + v4()]) + ']';
  return Array.from({ length: 1 + rnd(rnd(6) ? 3 : 6) }, label).join('.');
};
const noise = '.@"\\[]- \n\tAé😀:';
let accepted = 0;
let refused = 0;
for (let i = 0; i < 200000; i++) {
  let s = local() + '@' + domain();
  const m = rnd(3);
  if (m === 1) { const p = rnd(s.length + 1); s = s.slice(0, p) + pick(noise) + s.slice(p); }
  if (m === 2) { const p = rnd(s.length); s = s.slice(0, p) + s.slice(p + 1); }
  const want = formats.email(s);
  assert.strictEqual(email(s), want, `emitted email against runtime: ${JSON.stringify(s)}`);
  if (want) accepted++; else refused++;
}
assert.ok(accepted > 50000 && refused > 50000, `generated addresses not mixed enough: ${accepted} accepted, ${refused} refused`);

console.log(`format char masks: ${checked} code point checks, 200000 generated addresses (${accepted} accepted) agree`);
