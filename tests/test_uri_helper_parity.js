'use strict';

// `uri` exists twice: as a function in lib/formats.js, and as the source text
// the code generator hoists and calls. Two copies of one algorithm is what
// this file has always done for every format, and they have drifted before.
// This holds them together over a corpus built from the walk's own boundaries
// rather than from a handful of examples: every scheme, authority and tail
// shape the code branches on, crossed, plus seeded random strings over the
// bytes that decide the answer.

const assert = require('assert');
const formats = require('../lib/formats');
const { Validator } = require('..');

function corpus () {
  const out = [];
  const schemes = ['http', 'https', 'urn', 'mailto', 'a', 'a+b-c.d', 'A1', '1bad', '', '+bad'];
  const auths = ['', '//', '//host', '//host:80', '//host:', '//host:x', '//u@host', '//u:p@host',
    '//[::1]', '//[::1]:80', '//[::1]x', '//[::1', '//]::1[', '//u@[::1]', '//[a]@host',
    '//a:b:c', '//a:1:2', '//host.with.dots', '//-lead', '//tr ail', '//h%41ost', '//h%zz',
    '//@', '//@@', '//:80', '//host:99999', '//h#f', '//h?q', '//h/p'];
  const tails = ['', '/', '/p', '/p/q', '?q=1', '#f', '/p?q=1#f', '/%41', '/%zz', '/%4', '/%',
    '/a b', '/a\tb', '/a\\b', '/a"b', '/a<b', '/a>b', '/a^b', '/a`b', '/a{b', '/a|b', '/a}b',
    '/\u0000', '/\u007f', '/\u00e9', '/\u2028', "/ok~-._!$&'()*+,;=:@"];
  for (const s of schemes) for (const a of auths) for (const t of tails) { out.push(s + ':' + a + t); out.push(s + a + t); }
  for (const x of ['', ':', '//', 'a:', 'a', '///', '::', 'a::', 'a:/', 'a://', 'a:///',
    'x'.repeat(200), 'x'.repeat(200) + ':' + 'y'.repeat(200), '%', '%4', '%41', 'a:%zz']) out.push(x);
  // Seeded, so a failure is reproducible.
  const alphabet = 'abzAZ09+-.:/?#[]@!$&\'()*,;=%~_ \t"<>\\^`{|}\u0000\u007f\u00e9\u2028';
  let seed = 0x2f6e2b1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 20000; i++) {
    const n = 1 + Math.floor(rnd() * 24);
    let s = '';
    for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    out.push(s);
  }
  return out;
}

const C = corpus();

// The generated text, built and run the way the code generator builds it.
let fromSource = null;
try {
  // eslint-disable-next-line no-new-func
  fromSource = new Function(formats.uriHelperSource('_uri') + ';return _uri')();
} catch (e) {
  if (!/call to Function|code generation/i.test(String(e && e.message))) throw e;
}

// A compiled validator, which is the path a real schema takes.
const compiled = new Validator({ type: 'string', format: 'uri' });

let checked = 0;
let bad = 0;
for (const s of C) {
  const byFunction = formats.uri(s);
  if (fromSource !== null && fromSource(s) !== byFunction) {
    if (bad++ < 10) console.error(`helper text disagrees on ${JSON.stringify(s)}: function=${byFunction} text=${fromSource(s)}`);
  }
  if (compiled.isValidObject(s) !== byFunction) {
    if (bad++ < 10) console.error(`compiled validator disagrees on ${JSON.stringify(s)}: function=${byFunction} compiled=${compiled.isValidObject(s)}`);
  }
  checked++;
}
assert.strictEqual(bad, 0, `${bad} disagreements between the two copies of uri`);

// A few answers pinned outright, so a corpus that agrees with itself while both
// copies are wrong still fails.
const YES = ['https://www.example.com/images/248', 'http://a.io', 'urn:isbn:1', 'mailto:x@y.com',
  'http://[::1]:80/p', 'http://u:p@host:8080/a?b=c#d', 'a:', 'HTTP://X', 'http://h/%41'];
const NO = ['', 'nope', '//host/path', '/rel', '1http://a', 'http://a b.com', 'http://host:x',
  'http://[::1]x', 'http://[::1', 'http://a:1:2', 'http:/%4', 'http://h/a\\b', 'http://h/a`b'];
for (const s of YES) assert.strictEqual(formats.uri(s), true, `expected ${JSON.stringify(s)} to be a uri`);
for (const s of NO) assert.strictEqual(formats.uri(s), false, `expected ${JSON.stringify(s)} not to be a uri`);

console.log(`ok: uri agrees across ${fromSource === null ? 'function and compiled validator' : 'function, generated text and compiled validator'} on ${checked} strings`);
