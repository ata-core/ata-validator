'use strict';

// `uri` answers the common shape with one regular expression before it walks
// the string. That is only sound if the expression never accepts something the
// walk rejects: a fast path that is wider than the walk is a silent accept, the
// failure this project treats as the worst. So the relation checked here is
// one-sided. Every string the expression accepts must be a uri by the walk;
// strings it declines are the walk's to decide and are not compared.
//
// The first version of the expression had exactly that hole: with the "//"
// group optional, "http://[::1" skipped it and matched "//[::1" as a path.
// It is pinned below along with the other authority shapes the fast path
// must leave to the walk.

const assert = require('assert');
const formats = require('../lib/formats');

const FAST = formats.URI_FAST;

// The walk, without the fast path in front of it: the hoisted helper text with
// its first statement removed. Asserting on the strip keeps this from silently
// comparing the fast path with itself if the helper's shape changes.
const src = formats.uriHelperSource('_uri');
const lead = 'if(_ufa.test(_s))return true;';
assert.ok(src.includes(lead), 'the helper opens with the fast path');
let walk = null;
try {
  // eslint-disable-next-line no-new-func
  walk = new Function(src.replace(lead, '') + ';return _uri')();
} catch (e) {
  if (!/call to Function|code generation/i.test(String(e && e.message))) throw e;
}
if (walk === null) {
  console.log('skip: code generation is blocked, the walk cannot be built on its own here');
  process.exit(0);
}

let checked = 0;
let accepted = 0;
let bad = 0;
function check (s) {
  checked++;
  if (!FAST.test(s)) return;
  accepted++;
  if (!walk(s) || !formats.uri(s)) {
    if (bad++ < 10) console.error(`fast path accepts ${JSON.stringify(s)}, the walk does not`);
  }
}

// Every character class the two disagree on, plus the ones that steer the walk.
const A = ['a', 'Z', '1', '+', '-', '.', ':', '/', '?', '#', '@', '[', ']', '%', 'F', ' ', '"',
  '\\', '~', '_', '!', '\u00e9', '^', '{', '\n', "'", '=', ';', '*'];
const prefixes = ['', 'h', 'http:', 'http://', 'a:', 'a://', 'x:/', 'mailto:'];
function all (s, depth) {
  check(s);
  if (depth === 0) return;
  for (const c of A) all(s + c, depth - 1);
}
for (const p of prefixes) all(p, 3);

// xorshift: the low bits of a plain LCG repeat in short cycles, which starves
// the choices below of variety.
let seed = 0x5eed;
const rnd = (n) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
for (let k = 0; k < 300000; k++) {
  let s = prefixes[rnd(prefixes.length)];
  const n = rnd(24);
  for (let i = 0; i < n; i++) s += A[rnd(A.length)];
  check(s);
}

assert.strictEqual(bad, 0, `${bad} strings accepted by the fast path and rejected by the walk`);
// A subset check that compared nothing would pass too. It has to have seen a
// real share of accepts for the result above to mean anything.
assert.ok(accepted > 10000, `the fast path accepted only ${accepted} strings, the check is not exercising it`);

// The shapes the fast path must hand to the walk, each of which the walk rejects.
for (const s of ['http://[::1', 'http://[::1]x', 'http://a:1:2', 'http://host:x', 'http://h%zz',
  'http://h/%4', 'http://[a]@host', 'http://a b', 'http:/%']) {
  assert.strictEqual(FAST.test(s), false, `fast path must decline ${JSON.stringify(s)}`);
  assert.strictEqual(formats.uri(s), false, `${JSON.stringify(s)} is not a uri`);
}
// And the shape it exists for, so a change that quietly stops it engaging fails.
for (const s of ['https://www.example.com/images/248', 'http://a.io', 'urn:isbn:1', 'mailto:x@y.com', 'file:///tmp/x']) {
  assert.strictEqual(FAST.test(s), true, `fast path should take ${JSON.stringify(s)}`);
}

// Linear time on long inputs, accepted and declined alike.
for (const s of ['a:' + '/'.repeat(200000), 'a://' + 'b'.repeat(200000) + '@', 'a' + '+'.repeat(200000),
  'http://' + 'a'.repeat(200000) + '/' + '['.repeat(200000) + '%']) {
  const t = process.hrtime.bigint();
  FAST.test(s);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 100, `fast path took ${ms.toFixed(1)} ms on a ${s.length}-character input`);
}

console.log(`ok: uri fast path is a subset of the walk, ${accepted} accepts checked out of ${checked} strings`);
