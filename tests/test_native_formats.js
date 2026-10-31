'use strict';

// The native engine checks seven formats itself (lib/buffer-gate.js
// NATIVE_FORMATS); every other format sends the schema through validate().
// Those seven must answer as lib/formats.js does, or the buffer APIs accept
// what validate() rejects. They did not: an address with a doubled dot, a
// date of 2020-02-30, a URI with a non-ASCII host, an IPv4 octet with a
// leading zero, a hostname ending in a hyphen. This holds the two to the same
// answer on the official suite's strings, mutations of them, and random text.
// Skipped without the addon.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../lib/validator-core.js');
const F = require('../lib/formats.js');

const native = core._internals.getNative();
if (!native) {
  console.log('skip: native addon not loaded');
  process.exit(0);
}

const FORMATS = ['email', 'date', 'uri', 'uuid', 'ipv4', 'ipv6', 'hostname'];

const samples = new Set();
const suite = path.join(__dirname, 'suite', 'tests');
(function walk (d) {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.json')) {
      for (const g of JSON.parse(fs.readFileSync(p, 'utf8'))) for (const t of g.tests || []) if (typeof t.data === 'string') samples.add(t.data);
    }
  }
})(suite);
for (const s of [...samples]) { samples.add(s + 'x'); samples.add('\u00e9' + s); samples.add(s.slice(1)); samples.add(s.toUpperCase()); }

const alpha = 'abcAB09.:-@[]/%?#_~!$&\'()*+,;=" \\vV2585\u00e9xzfF0123456789:::';
const seeds = ['a@b.co', 'x.y+z@ex-ample.com', '"q"@h.io', 'u@[1.2.3.4]', 'u@[IPv6:::1]', '2020-02-29', 'http://a.b/c?d#e', 'urn:x:y',
  'http://[::1]:80/', 'http://[v1.x]/', 'http://[fe80::1%25eth0]/', '1.2.3.4', '::ffff:1.2.3.4', 'fe80::1', 'a-b.c', '3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60'];
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let i = 0; i < 20000; i++) {
  if (rnd(4) === 0) { samples.add(Array.from({ length: rnd(20) }, () => alpha[rnd(alpha.length)]).join('')); continue; }
  const a = [...seeds[rnd(seeds.length)]];
  for (let k = 1 + rnd(3); k > 0; k--) {
    const op = rnd(3), p = rnd(a.length + 1);
    if (op === 0) a.splice(p, 0, alpha[rnd(alpha.length)]); else if (op === 1) a.splice(p, 1); else a[p] = alpha[rnd(alpha.length)];
  }
  samples.add(a.join(''));
}

let checks = 0;
for (const f of FORMATS) {
  const slot = native.fastRegister(JSON.stringify({ type: 'string', format: f }));
  for (const s of samples) {
    const got = native.rawFastValidate(slot, Buffer.from(JSON.stringify(s)));
    assert.strictEqual(got, !!F[f](s), `format ${f}: native ${got} for ${JSON.stringify(s)}`);
    checks++;
  }
}
console.log(`ok: the native format checks answer as lib/formats.js on ${checks} strings across ${FORMATS.length} formats`);
