'use strict';
// lib/kernels/formats-small.mjs against the scanners it stands in for
// (lib/kernels/formats.mjs, the current engine's own checks): the same answer
// on every string of up to LEN characters over an alphabet with a member of
// every character class the grammar tells apart, on strings built from the
// URI grammar and mutated, and on the official suite's format tests.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const LEN = +(process.env.FORMATS_SMALL_LEN || 4);

(async () => {
  const big = await import('../lib/kernels/formats.mjs');
  const small = await import('../lib/kernels/formats-small.mjs');
  const pairs = [['uri', big.fmt_uri, small.fmt_uri_s], ['uri-reference', big.fmt_uri_reference, small.fmt_uri_reference_s], ['email', big.fmt_email, small.fmt_email_s]];
  let checked = 0;
  const same = (s) => { for (const [name, a, b] of pairs) { const x = a(s); const y = b(s); checked++; if (x !== y) assert.fail(`${name}: ${JSON.stringify(s)} is ${x} in the scanner and ${y} here`); } };

  // Every string of up to LEN characters: letters (hex and not, both cases,
  // v), digits that matter to ports and %25, and each delimiter.
  const A = ['a', 'F', 'g', 'v', 'Z', '0', '2', '5', '9', ':', '/', '?', '#', '[', ']', '@', '%', '.', '-', '+', '!', '~', ' ', 'é'];
  const walk = (s, n) => { same(s); if (n === 0) return; for (const c of A) walk(s + c, n - 1); };
  walk('', LEN);

  // Strings from the grammar, and each with one character changed, dropped or doubled.
  let seed = 42; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pick = (a) => a[rnd(a.length)];
  const H = () => pick(['0', '1', 'a', 'F', 'ff', 'abcd', '0db8', '12345']);
  const v4 = () => [1, 2, 3, 4].map(() => pick(['0', '1', '9', '25', '255', '256', '01', '199'])).join('.');
  const v6 = () => pick([
    () => Array.from({ length: 8 }, H).join(':'),
    () => Array.from({ length: rnd(7) }, H).join(':') + '::' + Array.from({ length: rnd(4) }, H).join(':'),
    () => Array.from({ length: 6 }, H).join(':') + ':' + v4(),
    () => '::' + pick(['', '1', 'ffff:' + v4()]),
    () => Array.from({ length: rnd(9) + 1 }, H).join(':'),
  ])();
  const seg = () => pick(['', 'a', 'b%20c', '%2', '%zz', 'x:y', 'a@b', "!$&'()*+,;=", '-._~', 'é']);
  const host = () => pick([() => 'example.com', () => '', () => '[' + v6() + ']', () => '[' + v6() + '%25' + pick(['eth0', '', '%41', 'x%']) + ']', () => '[v' + pick(['1', 'F', '', 'g']) + '.' + pick(['x', '', 'a:b']) + ']', () => v4(), () => 'a[b]', () => 'h:1:2'])();
  const uriOf = () => (rnd(4) ? pick(['http', 'a', 'A+b.c-d', '1x', '']) + ':' : '') +
    (rnd(2) ? '//' + (rnd(3) ? '' : pick(['u', 'u:p', 'u@x', 'u[1]', '%41']) + '@') + host() + (rnd(2) ? '' : ':' + pick(['', '80', '8a', '65535'])) : '') +
    Array.from({ length: rnd(4) }, () => (rnd(4) ? '/' : '') + seg()).join('') +
    (rnd(3) ? '' : '?' + pick(['', 'q=1', 'a?b', '#', '[x]'])) + (rnd(3) ? '' : '#' + pick(['', 'f', 'f#g', 'é']));
  for (let i = 0, n = +(process.env.FORMATS_SMALL_GEN || 200000); i < n; i++) {
    const s = uriOf(); same(s);
    const j = rnd(s.length + 1); const c = pick(A);
    same(s.slice(0, j) + c + s.slice(j)); same(s.slice(0, j) + s.slice(j + 1)); same(s.slice(0, j) + s.slice(j, j + 1) + s.slice(j));
  }

  // Addresses: each part from the grammar and its near misses, joined, and
  // each with one character changed, dropped or doubled. Lengths near 64,
  // 63 and 253.
  const E = ['a', 'Z', '0', '-', '.', '@', '"', '\\', ' ', '[', ']', ':', 'v', '6', '!', '(', 'é'];
  const local = () => pick([() => 'a', () => 'a.b', () => '.a', () => 'a.', () => 'a..b', () => "!#$%&'*+-/=?^_`{|}~", () => '"' + pick(['', 'x y', 'a@b', 'a\\"b', 'a\\', 'é', '\\é']) + '"', () => '"a"b', () => 'x'.repeat(63 + rnd(3)), () => '"' + 'x'.repeat(61 + rnd(3)) + '"'])();
  const label = () => pick(['a', 'a-b', '-a', 'a-', '0', 'x'.repeat(62 + rnd(3)), 'é', 'a_b']);
  const domain = () => pick([() => Array.from({ length: 1 + rnd(4) }, label).join('.'), () => '', () => 'a..b', () => '[' + pick(['', 'IPv6:', 'ipv6:', 'IPV6:']) + pick([v6(), v4()]) + ']', () => '[' + v4(), () => Array.from({ length: 4 + rnd(2) }, () => 'x'.repeat(62)).join('.')])();
  for (let i = 0, n = +(process.env.FORMATS_SMALL_GEN || 200000); i < n; i++) {
    const s = local() + '@' + domain(); same(s)
    const j = rnd(s.length + 1); const c = pick(E)
    same(s.slice(0, j) + c + s.slice(j)); same(s.slice(0, j) + s.slice(j + 1))
  }
  const walkE = (s, n) => { same(s); if (n === 0) return; for (const c of E) walkE(s + c, n - 1); };
  walkE('', Math.min(LEN, 5));

  // The suite's format tests.
  const SUITE = path.join(__dirname, 'suite/tests');
  for (const d of fs.readdirSync(SUITE)) {
    for (const f of ['uri.json', 'uri-reference.json', 'email.json']) {
      const p = path.join(SUITE, d, 'optional/format', f);
      if (!fs.existsSync(p)) continue;
      for (const g of JSON.parse(fs.readFileSync(p, 'utf8'))) for (const t of g.tests) if (typeof t.data === 'string') same(t.data);
    }
  }
  console.log(`ok: formats-small agrees with the scanners on ${checked} checks (exhaustive to ${LEN} characters over ${A.length})`);
})().catch((e) => { console.error(e); process.exit(1); });
